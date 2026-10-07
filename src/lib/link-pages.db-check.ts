/**
 * Link pages against a real database. Run with `pnpm test:db`.
 *
 * Three things are worth a live database rather than a unit test:
 *
 *  - **A draft is invisible, and so is a suspended church's page.** This is
 *    the public surface of the feature; getting it wrong publishes something
 *    a church has not finished writing.
 *  - **One church never sees another's page or items.** Both tables carry
 *    `churchId` precisely so this cannot drift, and the test is what says the
 *    scoping is actually in the queries.
 *  - **The item count is not silently zero.** A correlated subquery in a
 *    join-less drizzle query returns 0 for every row with no error at all
 *    (see AGENTS.md); only a real database shows which form is which.
 *
 * Creates its own churches and removes exactly what it created.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, form, givingLink, linkPage, linkPageItem } from "@/db/schema";
import {
  countLinkPageView,
  getLinkPage,
  getPublicLinkPage,
  itemCount,
  listInternalLinks,
  listLinkPages,
  nextPosition,
  slugIsFree,
  suggestPageSlug,
} from "@/lib/link-pages";

const stamp = Date.now();
const churchId = `lp-check-${stamp}`;
const otherId = `lp-other-${stamp}`;
const slug = `lp-published-${stamp}`;
const draftSlug = `lp-draft-${stamp}`;

let pageId = "";
let draftId = "";
let otherPageId = "";

beforeAll(async () => {
  await db
    .insert(church)
    .values([
      {
        id: churchId,
        name: `Link Page Check ${stamp}`,
        slug: churchId,
        currency: "NGN",
        handle: `lpc${stamp}`,
        theme: "forest",
      },
      {
        id: otherId,
        name: "Another Church",
        slug: otherId,
        currency: "NGN",
      },
    ])
    .onConflictDoNothing();

  const [published] = await db
    .insert(linkPage)
    .values({
      churchId,
      slug,
      title: "Grace Chapel",
      tagline: "Sundays 8am",
      status: "published",
      style: "bold",
      layout: "cards",
    })
    .returning({ id: linkPage.id });
  pageId = published.id;

  const [draft] = await db
    .insert(linkPage)
    .values({ churchId, slug: draftSlug, title: "Not ready", status: "draft" })
    .returning({ id: linkPage.id });
  draftId = draft.id;

  const [theirs] = await db
    .insert(linkPage)
    .values({
      churchId: otherId,
      slug: `lp-theirs-${stamp}`,
      title: "Theirs",
      status: "published",
    })
    .returning({ id: linkPage.id });
  otherPageId = theirs.id;

  await db.insert(linkPageItem).values([
    {
      pageId,
      churchId,
      label: "Give",
      url: "/give/grace",
      kind: "giving",
      position: 0,
    },
    {
      pageId,
      churchId,
      label: "WhatsApp",
      url: "https://chat.whatsapp.com/abc",
      kind: "external",
      position: 1,
    },
    {
      pageId,
      churchId,
      label: "Switched off",
      url: "https://example.com",
      kind: "external",
      position: 2,
      isActive: false,
    },
  ]);

  await db.insert(linkPageItem).values({
    pageId: otherPageId,
    churchId: otherId,
    label: "Their link",
    url: "https://theirs.example",
    kind: "external",
    position: 0,
  });
});

afterAll(async () => {
  // Items go with the page by cascade; the churches go last.
  await db.delete(linkPage).where(inArray(linkPage.churchId, [churchId, otherId]));
  await db.delete(church).where(inArray(church.id, [churchId, otherId]));
});

describe("what the public can see", () => {
  it("serves a published page with its style and its live items", async () => {
    const page = await getPublicLinkPage(slug);
    expect(page).not.toBeNull();
    expect(page!.title).toBe("Grace Chapel");
    expect(page!.style).toBe("bold");
    expect(page!.layout).toBe("cards");
    expect(page!.churchTheme).toBe("forest");
    expect(page!.items.map((i) => i.label)).toEqual(["Give", "WhatsApp"]);
  });

  it("leaves a switched-off link off the page entirely", async () => {
    const page = await getPublicLinkPage(slug);
    expect(page!.items.some((i) => i.label === "Switched off")).toBe(false);
  });

  it("keeps the items in the order the church chose", async () => {
    const page = await getPublicLinkPage(slug);
    expect(page!.items[0].label).toBe("Give");
    expect(page!.items[1].label).toBe("WhatsApp");
  });

  it("gives a DRAFT exactly the same answer as a slug nobody has taken", async () => {
    /*
     * Both null, and that is the point. A different answer for each would turn
     * this address into a way of confirming that a church is working on a page
     * it has not published.
     */
    expect(await getPublicLinkPage(draftSlug)).toBeNull();
    expect(await getPublicLinkPage(`nobody-has-this-${stamp}`)).toBeNull();
  });

  it("goes dark with a suspended church", async () => {
    /*
     * Without this, the one part of a suspended church still online would be
     * the page whose whole job is to advertise it.
     */
    await db
      .update(church)
      .set({ status: "suspended" })
      .where(eq(church.id, churchId));
    expect(await getPublicLinkPage(slug)).toBeNull();

    await db
      .update(church)
      .set({ status: "active" })
      .where(eq(church.id, churchId));
    expect(await getPublicLinkPage(slug)).not.toBeNull();
  });
});

describe("tenancy", () => {
  it("never lists another church's pages", async () => {
    const mine = await listLinkPages(churchId);
    expect(mine.some((p) => p.title === "Theirs")).toBe(false);
    expect(mine.map((p) => p.id).sort()).toEqual([pageId, draftId].sort());
  });

  it("refuses to open another church's page by its uuid", async () => {
    // A uuid in a URL is not a tenancy check.
    expect(await getLinkPage(churchId, otherPageId)).toBeNull();
    expect(await getLinkPage(otherId, pageId)).toBeNull();
  });

  it("opens its own", async () => {
    const got = await getLinkPage(churchId, pageId);
    expect(got).not.toBeNull();
    expect(got!.items).toHaveLength(3); // the editor sees the switched-off one
  });

  it("never counts another church's items", async () => {
    expect(await itemCount(churchId, pageId)).toBe(3);
    expect(await itemCount(otherId, pageId)).toBe(0);
  });
});

describe("the item count on the list", () => {
  it("is the real number, not silently zero", async () => {
    /*
     * The trap this exists for: a correlated subquery in a `sql` template with
     * no join loses its table qualifier, Postgres binds both names to the
     * inner table, and the count is 0 on every row for ever — no error, no
     * warning. `listLinkPages` uses a grouped aggregate joined in JS instead.
     */
    const pages = await listLinkPages(churchId);
    const published = pages.find((p) => p.id === pageId);
    const draft = pages.find((p) => p.id === draftId);
    expect(published?.itemCount).toBe(3);
    expect(draft?.itemCount).toBe(0);
  });
});

describe("the address", () => {
  it("knows a taken slug from a free one", async () => {
    expect(await slugIsFree(slug)).toBe(false);
    expect(await slugIsFree(`free-${stamp}`)).toBe(true);
  });

  it("lets a page keep its own slug when it is being edited", async () => {
    // Otherwise saving a page without changing the address would refuse it.
    expect(await slugIsFree(slug, pageId)).toBe(true);
    expect(await slugIsFree(slug, draftId)).toBe(false);
  });

  it("suggests the plain word when it is free, and a suffix when it is not", async () => {
    const free = await suggestPageSlug(`grace-${stamp}`);
    expect(free).toBe(`grace-${stamp}`);

    const taken = await suggestPageSlug(slug);
    expect(taken).not.toBe(slug);
    expect(taken.startsWith(slug)).toBe(true);
    expect(await slugIsFree(taken)).toBe(true);
  });
});

describe("adding a link", () => {
  it("puts the next one at the bottom", async () => {
    expect(await nextPosition(churchId, pageId)).toBe(3);
  });

  it("starts at zero on an empty page", async () => {
    expect(await nextPosition(churchId, draftId)).toBe(0);
  });
});

describe("counting a view", () => {
  it("adds one to a published page", async () => {
    const [before] = await db
      .select({ n: linkPage.viewCount })
      .from(linkPage)
      .where(eq(linkPage.id, pageId));
    await countLinkPageView(slug);
    const [after] = await db
      .select({ n: linkPage.viewCount, at: linkPage.lastViewAt })
      .from(linkPage)
      .where(eq(linkPage.id, pageId));
    expect(after.n).toBe(before.n + 1);
    expect(after.at).not.toBeNull();
  });

  it("counts nothing for a draft", async () => {
    await countLinkPageView(draftSlug);
    const [row] = await db
      .select({ n: linkPage.viewCount })
      .from(linkPage)
      .where(eq(linkPage.id, draftId));
    expect(row.n).toBe(0);
  });

  it("does not throw on a slug that does not exist", async () => {
    await expect(countLinkPageView(`nope-${stamp}`)).resolves.toBeUndefined();
  });
});

describe("the dropdown of the church's own pages", () => {
  it("offers the church's public page", async () => {
    const links = await listInternalLinks(churchId);
    const own = links.find((l) => l.kind === "church");
    expect(own?.path).toBe(`/c/lpc${stamp}`);
  });

  it("offers a live giving page and an open form, and nothing in draft", async () => {
    await db.insert(givingLink).values([
      { churchId, slug: `gl-live-${stamp}`, title: "Building fund", isActive: true },
      { churchId, slug: `gl-off-${stamp}`, title: "Old appeal", isActive: false },
    ]);
    await db.insert(form).values([
      { churchId, slug: `f-open-${stamp}`, title: "Carol service", status: "open" },
      { churchId, slug: `f-draft-${stamp}`, title: "Half written", status: "draft" },
    ]);

    const links = await listInternalLinks(churchId);
    const labels = links.map((l) => l.label);

    expect(labels).toContain("Building fund");
    expect(labels).toContain("Carol service");
    /*
     * The reason only live things are offered: a button in an Instagram bio
     * that leads to a 404 is worse than a missing button, because nobody
     * checks a bio link after the day they set it.
     */
    expect(labels).not.toContain("Old appeal");
    expect(labels).not.toContain("Half written");

    const giving = links.find((l) => l.label === "Building fund");
    expect(giving?.kind).toBe("giving");
    expect(giving?.path).toBe(`/give/gl-live-${stamp}`);
  });

  it("never offers another church's pages", async () => {
    await db.insert(givingLink).values({
      churchId: otherId,
      slug: `gl-theirs-${stamp}`,
      title: "Their fund",
      isActive: true,
    });
    const links = await listInternalLinks(churchId);
    expect(links.some((l) => l.label === "Their fund")).toBe(false);
    expect(links.every((l) => !l.path.includes("theirs"))).toBe(true);
  });

  it("hands back only site-relative paths, never a bare host", async () => {
    // These go straight into an item's `url`, and a path is what marks an
    // internal link as internal — including for `rel="noopener"` on the page.
    const links = await listInternalLinks(churchId);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      expect(l.path.startsWith("/"), `${l.label} -> ${l.path}`).toBe(true);
      expect(l.path.startsWith("//"), `${l.label} -> ${l.path}`).toBe(false);
    }
  });
});
