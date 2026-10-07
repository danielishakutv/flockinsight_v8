"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { linkPage, linkPageItem } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { audit } from "@/lib/audit";
import {
  DESCRIPTION_MAX,
  MAX_ITEMS,
  TAGLINE_MAX,
  TITLE_MAX,
  cleanItemUrl,
  cleanLabel,
  getLinkPageLayout,
  getLinkPageStyle,
  isItemKind,
  isPageStatus,
  linkPagePath,
  normalisePageSlug,
  pageSlugProblem,
  reorder,
} from "@/lib/link-page-shared";
import {
  itemCount,
  listItems,
  nextPosition,
  slugIsFree,
  suggestPageSlug,
} from "@/lib/link-pages";

export type ActionResult =
  | { ok: true; id?: string; slug?: string }
  | { ok: false; error: string };

/**
 * Link pages: the writes.
 *
 * One guard, applied to every one of them, because every action here changes
 * what a public page says. The order matters — plan, then permission, then
 * tenancy — and tenancy is checked against the row rather than trusted from
 * the argument, every time.
 *
 * The lesson these follow is the one the facilities module cost: **assume any
 * action reachable with a `.view` permission will be called directly with a
 * crafted payload.** These need `links.manage`, and still re-check that the
 * page being edited belongs to the caller's church before touching it.
 */
async function guard() {
  const gate = await refuseWithoutFeature("linkPages");
  if (gate) return { ctx: null, refusal: gate };
  const ctx = await requireChurch();
  if (!(await can("links.manage"))) {
    return {
      ctx: null,
      refusal: {
        ok: false as const,
        error: "You don't have permission to manage link pages.",
      },
    };
  }
  return { ctx, refusal: null };
}

/**
 * This page, if it is really this church's.
 *
 * Returns null for another church's uuid and for one that does not exist, with
 * no way to tell the two apart — a uuid in a URL is not a tenancy check, and
 * "that page belongs to somebody else" is itself a fact worth not leaking.
 */
async function ownPage(churchId: string, pageId: string) {
  const [row] = await db
    .select({ id: linkPage.id, slug: linkPage.slug, title: linkPage.title })
    .from(linkPage)
    .where(and(eq(linkPage.id, pageId), eq(linkPage.churchId, churchId)))
    .limit(1);
  return row ?? null;
}

const NOT_YOURS = { ok: false as const, error: "That page could not be found." };

function refresh(pageId?: string) {
  revalidatePath("/links");
  if (pageId) revalidatePath(`/links/pages/${pageId}`);
}

/* ============================================================
 * The page
 * ========================================================== */

export async function createLinkPage(input: {
  title: string;
  slug: string;
}): Promise<ActionResult> {
  const { ctx, refusal } = await guard();
  if (refusal) return refusal;

  const title = input.title.trim().slice(0, TITLE_MAX) || "Our links";

  /*
   * An empty slug is suggested from the title rather than refused.
   *
   * A church typing "Our links" and pressing Create should get a page, not a
   * lecture about addresses. They can change it before publishing.
   */
  const asked = normalisePageSlug(input.slug);
  const slug = asked || (await suggestPageSlug(title));

  const problem = pageSlugProblem(slug);
  if (problem) return { ok: false, error: problem };
  if (!(await slugIsFree(slug))) {
    return { ok: false, error: "That address is already taken. Try another." };
  }

  const [row] = await db
    .insert(linkPage)
    .values({
      churchId: ctx.church.id,
      slug,
      title,
      createdBy: ctx.user.id,
    })
    .returning({ id: linkPage.id, slug: linkPage.slug });

  await audit({
    churchId: ctx.church.id,
    action: "links.page.create",
    targetType: "link_page",
    targetId: row.id,
    targetLabel: title,
    summary: `Made the link page ${linkPagePath(row.slug)}`,
  });

  refresh(row.id);
  return { ok: true, id: row.id, slug: row.slug };
}

export async function updateLinkPage(input: {
  id: string;
  title?: string;
  tagline?: string | null;
  slug?: string;
  style?: string;
  layout?: string;
  showLogo?: boolean;
  showChurchName?: boolean;
}): Promise<ActionResult> {
  const { ctx, refusal } = await guard();
  if (refusal) return refusal;

  const existing = await ownPage(ctx.church.id, input.id);
  if (!existing) return NOT_YOURS;

  const patch: Record<string, unknown> = {};

  if (input.title !== undefined) {
    const title = input.title.trim().slice(0, TITLE_MAX);
    if (!title) return { ok: false, error: "The page needs a title." };
    patch.title = title;
  }

  if (input.tagline !== undefined) {
    const tagline = (input.tagline ?? "").trim().slice(0, TAGLINE_MAX);
    patch.tagline = tagline || null;
  }

  if (input.slug !== undefined) {
    const slug = normalisePageSlug(input.slug);
    const problem = pageSlugProblem(slug);
    if (problem) return { ok: false, error: problem };
    if (!(await slugIsFree(slug, input.id))) {
      return { ok: false, error: "That address is already taken. Try another." };
    }
    patch.slug = slug;
  }

  /*
   * A style or layout that is not in the list is normalised to the default
   * rather than refused.
   *
   * These come from a picker, so a bad value means either a stale tab or a
   * crafted request. Storing the default in both cases means the page always
   * renders, and `getLinkPageStyle` would have fallen back on read anyway —
   * so this just keeps the stored value honest about what will be drawn.
   */
  if (input.style !== undefined) patch.style = getLinkPageStyle(input.style).id;
  if (input.layout !== undefined) {
    patch.layout = getLinkPageLayout(input.layout).id;
  }
  if (input.showLogo !== undefined) patch.showLogo = Boolean(input.showLogo);
  if (input.showChurchName !== undefined) {
    patch.showChurchName = Boolean(input.showChurchName);
  }

  if (Object.keys(patch).length === 0) return { ok: true, id: input.id };

  await db
    .update(linkPage)
    .set(patch)
    .where(
      and(eq(linkPage.id, input.id), eq(linkPage.churchId, ctx.church.id)),
    );

  await audit({
    churchId: ctx.church.id,
    action: "links.page.update",
    targetType: "link_page",
    targetId: input.id,
    targetLabel: existing.title,
    summary:
      patch.slug !== undefined
        ? /*
           * An address change gets said out loud, because it is the one edit
           * with consequences outside this app: every bio and poster carrying
           * the old word now leads nowhere.
           */
          `Moved the link page ${linkPagePath(existing.slug)} to ${linkPagePath(patch.slug as string)}`
        : `Edited the link page ${linkPagePath(existing.slug)}`,
  });

  refresh(input.id);
  return { ok: true, id: input.id, slug: (patch.slug as string) ?? existing.slug };
}

export async function setLinkPageStatus(
  id: string,
  status: string,
): Promise<ActionResult> {
  const { ctx, refusal } = await guard();
  if (refusal) return refusal;
  if (!isPageStatus(status)) return { ok: false, error: "Unknown status." };

  const existing = await ownPage(ctx.church.id, id);
  if (!existing) return NOT_YOURS;

  /*
   * Publishing an empty page is refused.
   *
   * The address goes straight into an Instagram bio, and a bio pointing at a
   * page with nothing on it is worse than one pointing nowhere — it looks
   * like the church is broken rather than like the link is wrong.
   */
  if (status === "published") {
    const n = await itemCount(ctx.church.id, id);
    if (n === 0) {
      return {
        ok: false,
        error: "Add at least one link before publishing the page.",
      };
    }
  }

  await db
    .update(linkPage)
    .set({ status })
    .where(and(eq(linkPage.id, id), eq(linkPage.churchId, ctx.church.id)));

  await audit({
    churchId: ctx.church.id,
    action: status === "published" ? "links.page.publish" : "links.page.unpublish",
    targetType: "link_page",
    targetId: id,
    targetLabel: existing.title,
    summary: `${status === "published" ? "Published" : "Took down"} the link page ${linkPagePath(existing.slug)}`,
  });

  refresh(id);
  return { ok: true, id };
}

/**
 * Remove a page.
 *
 * A real delete, and the only one in this module, because the alternative is
 * worse: a page kept after a church asked for it to go is a public page about
 * them that they believe is gone. The confirmation lives in the UI, where a
 * person can see the address and the link count before agreeing.
 *
 * The slug becomes free again, unlike a short link code. A link page is not
 * printed on four hundred flyers — it is pasted into a bio that can be edited
 * — so holding the word for ever would cost a church its own name for nothing.
 */
export async function deleteLinkPage(id: string): Promise<ActionResult> {
  const { ctx, refusal } = await guard();
  if (refusal) return refusal;

  const existing = await ownPage(ctx.church.id, id);
  if (!existing) return NOT_YOURS;

  await db
    .delete(linkPage)
    .where(and(eq(linkPage.id, id), eq(linkPage.churchId, ctx.church.id)));

  await audit({
    churchId: ctx.church.id,
    action: "links.page.delete",
    targetType: "link_page",
    targetId: id,
    targetLabel: existing.title,
    severity: "warning",
    summary: `Deleted the link page ${linkPagePath(existing.slug)} ("${existing.title}") and everything on it`,
  });

  refresh();
  return { ok: true };
}

/** A free address built from a name, for the Suggest button. */
export async function suggestLinkPageSlug(
  base: string,
): Promise<{ slug: string } | null> {
  const { refusal } = await guard();
  if (refusal) return null;
  return { slug: await suggestPageSlug(base) };
}

/* ============================================================
 * The links on it
 * ========================================================== */

export async function addLinkItem(input: {
  pageId: string;
  label: string;
  url: string;
  kind?: string;
  description?: string | null;
}): Promise<ActionResult> {
  const { ctx, refusal } = await guard();
  if (refusal) return refusal;

  const page = await ownPage(ctx.church.id, input.pageId);
  if (!page) return NOT_YOURS;

  if ((await itemCount(ctx.church.id, input.pageId)) >= MAX_ITEMS) {
    return {
      ok: false,
      error: `A page holds up to ${MAX_ITEMS} links. Remove one, or make a second page.`,
    };
  }

  const label = cleanLabel(input.label);
  if ("error" in label) return { ok: false, error: label.error };

  /*
   * Through `cleanItemUrl`, always.
   *
   * It is what refuses `javascript:` and `data:`. This string is rendered as
   * an href on a page anybody can open, so a staff member who could get a
   * script address in here would have script running in every visitor's
   * browser — a stored XSS through an ordinary-looking form field. The pure
   * tests sweep that case.
   */
  const url = cleanItemUrl(input.url);
  if ("error" in url) return { ok: false, error: url.error };

  const kind = isItemKind(input.kind) ? input.kind : "external";
  const description =
    (input.description ?? "").trim().slice(0, DESCRIPTION_MAX) || null;

  const [row] = await db
    .insert(linkPageItem)
    .values({
      pageId: input.pageId,
      churchId: ctx.church.id,
      label: label.label,
      url: url.url,
      kind,
      description,
      position: await nextPosition(ctx.church.id, input.pageId),
    })
    .returning({ id: linkPageItem.id });

  await audit({
    churchId: ctx.church.id,
    action: "links.page.item.add",
    targetType: "link_page",
    targetId: input.pageId,
    targetLabel: page.title,
    summary: `Added "${label.label}" to the link page ${linkPagePath(page.slug)}`,
  });

  refresh(input.pageId);
  return { ok: true, id: row.id };
}

export async function updateLinkItem(input: {
  id: string;
  label?: string;
  url?: string;
  description?: string | null;
  isActive?: boolean;
}): Promise<ActionResult> {
  const { ctx, refusal } = await guard();
  if (refusal) return refusal;

  // Church-scoped, so an item id from another church simply is not found.
  const [existing] = await db
    .select({ id: linkPageItem.id, pageId: linkPageItem.pageId })
    .from(linkPageItem)
    .where(
      and(
        eq(linkPageItem.id, input.id),
        eq(linkPageItem.churchId, ctx.church.id),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, error: "That link could not be found." };

  const patch: Record<string, unknown> = {};

  if (input.label !== undefined) {
    const label = cleanLabel(input.label);
    if ("error" in label) return { ok: false, error: label.error };
    patch.label = label.label;
  }

  if (input.url !== undefined) {
    const url = cleanItemUrl(input.url);
    if ("error" in url) return { ok: false, error: url.error };
    patch.url = url.url;
  }

  if (input.description !== undefined) {
    patch.description =
      (input.description ?? "").trim().slice(0, DESCRIPTION_MAX) || null;
  }

  if (input.isActive !== undefined) patch.isActive = Boolean(input.isActive);

  if (Object.keys(patch).length === 0) return { ok: true, id: input.id };

  await db
    .update(linkPageItem)
    .set(patch)
    .where(
      and(
        eq(linkPageItem.id, input.id),
        eq(linkPageItem.churchId, ctx.church.id),
      ),
    );

  refresh(existing.pageId);
  return { ok: true, id: input.id };
}

export async function removeLinkItem(id: string): Promise<ActionResult> {
  const { ctx, refusal } = await guard();
  if (refusal) return refusal;

  const [existing] = await db
    .select({
      id: linkPageItem.id,
      pageId: linkPageItem.pageId,
      label: linkPageItem.label,
    })
    .from(linkPageItem)
    .where(
      and(
        eq(linkPageItem.id, id),
        eq(linkPageItem.churchId, ctx.church.id),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, error: "That link could not be found." };

  await db
    .delete(linkPageItem)
    .where(
      and(
        eq(linkPageItem.id, id),
        eq(linkPageItem.churchId, ctx.church.id),
      ),
    );

  await audit({
    churchId: ctx.church.id,
    action: "links.page.item.remove",
    targetType: "link_page",
    targetId: existing.pageId,
    summary: `Removed "${existing.label}" from a link page`,
  });

  refresh(existing.pageId);
  return { ok: true };
}

/**
 * Move one link up or down.
 *
 * The new order is computed by `reorder`, which renumbers every item from zero
 * — so positions that have drifted or collided repair themselves on the next
 * move rather than leaving a button that visibly does nothing.
 */
export async function moveLinkItem(
  id: string,
  direction: "up" | "down",
): Promise<ActionResult> {
  const { ctx, refusal } = await guard();
  if (refusal) return refusal;

  const [existing] = await db
    .select({ id: linkPageItem.id, pageId: linkPageItem.pageId })
    .from(linkPageItem)
    .where(
      and(
        eq(linkPageItem.id, id),
        eq(linkPageItem.churchId, ctx.church.id),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, error: "That link could not be found." };

  const items = await listItems(ctx.church.id, existing.pageId);
  const next = reorder(
    items.map((i) => ({ id: i.id, position: i.position })),
    id,
    direction,
  );

  /*
   * Only the rows whose number actually changed, in one transaction.
   *
   * Half an applied reorder is an order nobody chose, and the page is public —
   * so this is all-or-nothing rather than a loop of independent updates.
   */
  const before = new Map(items.map((i) => [i.id, i.position]));
  const changed = next.filter((n) => before.get(n.id) !== n.position);
  if (changed.length === 0) return { ok: true };

  await db.transaction(async (tx) => {
    for (const row of changed) {
      await tx
        .update(linkPageItem)
        .set({ position: row.position })
        .where(
          and(
            eq(linkPageItem.id, row.id),
            eq(linkPageItem.churchId, ctx.church.id),
          ),
        );
    }
  });

  refresh(existing.pageId);
  return { ok: true };
}
