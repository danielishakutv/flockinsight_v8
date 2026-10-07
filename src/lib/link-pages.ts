import "server-only";

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  contribution,
  event,
  firstTimerSignup,
  form,
  givingLink,
  linkPage,
  linkPageItem,
  livestream,
  memberSignup,
  shortLink,
} from "@/db/schema";
import {
  MAX_ITEMS,
  normalisePageSlug,
  type ItemKind,
} from "@/lib/link-page-shared";
import { randomSuffix } from "@/lib/slug";

/**
 * Link pages: the database half.
 *
 * The rules are all in `lib/link-page-shared.ts`, which is pure and tested.
 * This file reads and writes, and every single query is scoped by church —
 * both tables carry `churchId` so an item never has to be reached through its
 * page to find out whose it is, which is exactly the join somebody forgets.
 */

/* ============================================================
 * The dropdown: the church's own pages
 * ========================================================== */

export type InternalLink = {
  kind: ItemKind;
  /** The suggested button label. The church can change it after adding. */
  label: string;
  /** A site-relative path — `/give/grace`. */
  path: string;
  /** Which one it is, when there are several of a kind. */
  sublabel: string | null;
};

/**
 * Every public page this church already has, for the "add an internal link"
 * dropdown.
 *
 * The point of the whole feature: a church should not have to know, or type,
 * that its giving page is at `/give/grace-building-fund`. It picks the name it
 * already knows from a list, and the address comes with it.
 *
 * **Only pages that are actually live are offered.** A draft form, a disabled
 * sign-up link or a switched-off welcome link is not in this list, because the
 * one thing worse than not finding your link here is putting a button on a
 * public page that leads to a 404 — and nobody checks a bio link after the day
 * they set it.
 *
 * One query per source, in parallel. They are all small, church-scoped and
 * indexed, and a church with a hundred forms is a church with a hundred rows.
 */
export async function listInternalLinks(churchId: string): Promise<InternalLink[]> {
  const [
    churchRow,
    forms,
    givingLinks,
    pots,
    events,
    streams,
    welcome,
    signup,
    shortLinks,
  ] = await Promise.all([
    db
      .select({ name: church.name, handle: church.handle, slug: church.slug })
      .from(church)
      .where(eq(church.id, churchId))
      .limit(1),

    db
      .select({ title: form.title, slug: form.slug })
      .from(form)
      // "open" is the only one accepting answers. A "closed" form still has
      // a public page, but it only says "no longer accepting" — not something
      // worth a button in somebody's bio.
      .where(and(eq(form.churchId, churchId), eq(form.status, "open")))
      .orderBy(desc(form.updatedAt))
      .limit(100),

    db
      .select({ title: givingLink.title, slug: givingLink.slug })
      .from(givingLink)
      .where(and(eq(givingLink.churchId, churchId), eq(givingLink.isActive, true)))
      .orderBy(asc(givingLink.title))
      .limit(100),

    db
      .select({ title: contribution.title, slug: contribution.slug })
      .from(contribution)
      .where(
        and(
          eq(contribution.churchId, churchId),
          // A draft pot has no public page worth linking to.
          ne(contribution.status, "draft"),
        ),
      )
      .orderBy(desc(contribution.createdAt))
      .limit(100),

    db
      .select({ id: event.id, title: event.title })
      .from(event)
      .where(and(eq(event.churchId, churchId), eq(event.isPublic, true)))
      .orderBy(desc(event.createdAt))
      .limit(100),

    db
      .select({ title: livestream.title, slug: livestream.slug })
      .from(livestream)
      .where(eq(livestream.churchId, churchId))
      .orderBy(desc(livestream.createdAt))
      .limit(50),

    db
      .select({ slug: firstTimerSignup.slug, enabled: firstTimerSignup.enabled })
      .from(firstTimerSignup)
      .where(eq(firstTimerSignup.churchId, churchId))
      .limit(1),

    db
      .select({ slug: memberSignup.slug, enabled: memberSignup.enabled })
      .from(memberSignup)
      .where(eq(memberSignup.churchId, churchId))
      .limit(1),

    db
      .select({ code: shortLink.code, title: shortLink.title })
      .from(shortLink)
      .where(and(eq(shortLink.churchId, churchId), eq(shortLink.status, "active")))
      .orderBy(desc(shortLink.createdAt))
      .limit(100),
  ]);

  const out: InternalLink[] = [];
  const me = churchRow[0];

  if (me?.handle) {
    out.push({
      kind: "church",
      label: me.name,
      path: `/c/${me.handle}`,
      sublabel: "Your public church page",
    });
  }

  for (const g of givingLinks) {
    out.push({
      kind: "giving",
      label: g.title,
      path: `/give/${g.slug}`,
      sublabel: `/give/${g.slug}`,
    });
  }

  for (const f of forms) {
    out.push({
      kind: "form",
      label: f.title,
      path: `/f/${f.slug}`,
      sublabel: `/f/${f.slug}`,
    });
  }

  for (const c of pots) {
    out.push({
      kind: "contribution",
      label: c.title,
      path: `/p/${c.slug}`,
      sublabel: `/p/${c.slug}`,
    });
  }

  for (const e of events) {
    out.push({
      kind: "event",
      label: e.title,
      path: `/events/${e.id}`,
      sublabel: "Public event",
    });
  }

  for (const s of streams) {
    out.push({
      kind: "livestream",
      label: s.title,
      path: `/live/${s.slug}`,
      sublabel: `/live/${s.slug}`,
    });
  }

  if (welcome[0]?.enabled) {
    out.push({
      kind: "welcome",
      label: "I'm new here",
      path: `/welcome/${welcome[0].slug}`,
      sublabel: "Your first-timer welcome form",
    });
  }

  if (signup[0]?.enabled) {
    out.push({
      kind: "signup",
      label: "Join the church",
      path: `/join/${signup[0].slug}`,
      sublabel: "Your member sign-up link",
    });
  }

  for (const l of shortLinks) {
    out.push({
      kind: "shortLink",
      label: l.title || `/l/${l.code}`,
      path: `/l/${l.code}`,
      sublabel: `/l/${l.code}`,
    });
  }

  return out;
}

/* ============================================================
 * Reading
 * ========================================================== */

export type LinkPageRow = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  status: string;
  style: string;
  layout: string;
  showLogo: boolean;
  showChurchName: boolean;
  viewCount: number;
  lastViewAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  itemCount: number;
};

/** Every link page this church has, newest first, with how many links each holds. */
export async function listLinkPages(churchId: string): Promise<LinkPageRow[]> {
  const pages = await db
    .select()
    .from(linkPage)
    .where(eq(linkPage.churchId, churchId))
    .orderBy(desc(linkPage.createdAt))
    .limit(200);

  if (pages.length === 0) return [];

  /*
   * The counts as a grouped aggregate joined in JS, NOT a correlated subquery
   * in a raw `sql` template.
   *
   * A join-less correlated subquery silently loses its table qualifier in
   * drizzle and returns 0 for every row — see the note in AGENTS.md and
   * `lib/sql-safety.test.ts`, which fails the build on the shape. This is the
   * form that works.
   */
  const counts = await db
    .select({
      pageId: linkPageItem.pageId,
      n: sql<number>`count(*)::int`,
    })
    .from(linkPageItem)
    .where(
      and(
        eq(linkPageItem.churchId, churchId),
        inArray(
          linkPageItem.pageId,
          pages.map((p) => p.id),
        ),
      ),
    )
    .groupBy(linkPageItem.pageId);

  const byPage = new Map(counts.map((c) => [c.pageId, c.n]));

  return pages.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    tagline: p.tagline,
    status: p.status,
    style: p.style,
    layout: p.layout,
    showLogo: p.showLogo,
    showChurchName: p.showChurchName,
    viewCount: p.viewCount,
    lastViewAt: p.lastViewAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    itemCount: byPage.get(p.id) ?? 0,
  }));
}

export type LinkItemRow = {
  id: string;
  label: string;
  url: string;
  kind: string;
  description: string | null;
  position: number;
  isActive: boolean;
  clickCount: number;
};

/** One page and its links, for the editor. Null if it is not this church's. */
export async function getLinkPage(
  churchId: string,
  pageId: string,
): Promise<{ page: LinkPageRow; items: LinkItemRow[] } | null> {
  const [page] = await db
    .select()
    .from(linkPage)
    // Church-scoped, so one church cannot open another's page by guessing a
    // uuid out of a URL.
    .where(and(eq(linkPage.id, pageId), eq(linkPage.churchId, churchId)))
    .limit(1);
  if (!page) return null;

  const items = await listItems(churchId, pageId);

  return {
    page: {
      id: page.id,
      slug: page.slug,
      title: page.title,
      tagline: page.tagline,
      status: page.status,
      style: page.style,
      layout: page.layout,
      showLogo: page.showLogo,
      showChurchName: page.showChurchName,
      viewCount: page.viewCount,
      lastViewAt: page.lastViewAt,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      itemCount: items.length,
    },
    items,
  };
}

export async function listItems(
  churchId: string,
  pageId: string,
): Promise<LinkItemRow[]> {
  const rows = await db
    .select()
    .from(linkPageItem)
    .where(
      and(eq(linkPageItem.pageId, pageId), eq(linkPageItem.churchId, churchId)),
    )
    .orderBy(asc(linkPageItem.position), asc(linkPageItem.createdAt));

  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    url: r.url,
    kind: r.kind,
    description: r.description,
    position: r.position,
    isActive: r.isActive,
    clickCount: r.clickCount,
  }));
}

/* ============================================================
 * The public page
 * ========================================================== */

export type PublicLinkPage = {
  title: string;
  tagline: string | null;
  style: string;
  layout: string;
  showLogo: boolean;
  showChurchName: boolean;
  churchName: string;
  churchHandle: string | null;
  churchLogo: string | null;
  churchTheme: string;
  items: { label: string; url: string; description: string | null }[];
};

/**
 * What `/hub/<slug>` renders. Null for anything the public may not see.
 *
 * A draft returns null, exactly as an unknown slug does, so the two are
 * indistinguishable from outside: the address of a page a church is still
 * writing must not be something a stranger can confirm the existence of.
 *
 * Switched-off items are filtered here rather than in the page, so there is
 * one place that decides what is public.
 */
export async function getPublicLinkPage(
  slug: string,
): Promise<PublicLinkPage | null> {
  const [row] = await db
    .select({
      id: linkPage.id,
      churchId: linkPage.churchId,
      title: linkPage.title,
      tagline: linkPage.tagline,
      status: linkPage.status,
      style: linkPage.style,
      layout: linkPage.layout,
      showLogo: linkPage.showLogo,
      showChurchName: linkPage.showChurchName,
      churchName: church.name,
      churchHandle: church.handle,
      churchLogo: church.logo,
      churchTheme: church.theme,
      churchStatus: church.status,
    })
    .from(linkPage)
    .innerJoin(church, eq(church.id, linkPage.churchId))
    .where(eq(linkPage.slug, slug))
    .limit(1);

  if (!row) return null;
  if (row.status !== "published") return null;
  /*
   * A suspended church's public pages go dark with it. Without this, the one
   * part of a suspended church that stayed online would be the page whose
   * whole job is to advertise it.
   */
  if (row.churchStatus === "suspended") return null;

  const items = await db
    .select({
      label: linkPageItem.label,
      url: linkPageItem.url,
      description: linkPageItem.description,
    })
    .from(linkPageItem)
    .where(
      and(eq(linkPageItem.pageId, row.id), eq(linkPageItem.isActive, true)),
    )
    .orderBy(asc(linkPageItem.position), asc(linkPageItem.createdAt))
    .limit(MAX_ITEMS);

  return {
    title: row.title,
    tagline: row.tagline,
    style: row.style,
    layout: row.layout,
    showLogo: row.showLogo,
    showChurchName: row.showChurchName,
    churchName: row.churchName,
    churchHandle: row.churchHandle,
    churchLogo: row.churchLogo,
    churchTheme: row.churchTheme,
    items,
  };
}

/**
 * Count one view.
 *
 * Fire-and-forget from the page, and deliberately not awaited there: a slow
 * write must never be the reason somebody's bio link is slow to open. Failures
 * are swallowed on purpose here and ONLY here — the count is the least
 * important thing on the page, and there is nothing a visitor could do about
 * it. Everything else in this file lets its errors out.
 */
export async function countLinkPageView(slug: string): Promise<void> {
  try {
    await db
      .update(linkPage)
      .set({
        viewCount: sql`${linkPage.viewCount} + 1`,
        lastViewAt: new Date(),
      })
      .where(and(eq(linkPage.slug, slug), eq(linkPage.status, "published")));
  } catch {
    /* A missed view count is not worth a broken page. */
  }
}

/* ============================================================
 * Writing
 * ========================================================== */

/** Is this slug free? Globally, because the namespace has no church in it. */
export async function slugIsFree(
  slug: string,
  exceptPageId?: string,
): Promise<boolean> {
  const [clash] = await db
    .select({ id: linkPage.id })
    .from(linkPage)
    .where(eq(linkPage.slug, slug))
    .limit(1);
  if (!clash) return true;
  return exceptPageId ? clash.id === exceptPageId : false;
}

/**
 * A free slug built from a name.
 *
 * Tries the plain one first, because `/hub/grace` is the one worth having, and
 * only then adds a suffix. Gives up after a few attempts rather than looping:
 * at that point the church should be told to choose, not handed
 * `grace-x7f2k9`.
 */
export async function suggestPageSlug(base: string): Promise<string> {
  const root = normalisePageSlug(base) || "links";
  if (await slugIsFree(root)) return root;
  for (let i = 0; i < 5; i++) {
    const candidate = normalisePageSlug(`${root}-${randomSuffix(4)}`);
    if (await slugIsFree(candidate)) return candidate;
  }
  return normalisePageSlug(`${root}-${randomSuffix(8)}`);
}

/** The next position on a page, so a new link lands at the bottom. */
export async function nextPosition(
  churchId: string,
  pageId: string,
): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${linkPageItem.position})` })
    .from(linkPageItem)
    .where(
      and(eq(linkPageItem.pageId, pageId), eq(linkPageItem.churchId, churchId)),
    );
  return (row?.max ?? -1) + 1;
}

/** How many links a page already has, for the cap. */
export async function itemCount(
  churchId: string,
  pageId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(linkPageItem)
    .where(
      and(eq(linkPageItem.pageId, pageId), eq(linkPageItem.churchId, churchId)),
    );
  return row?.n ?? 0;
}
