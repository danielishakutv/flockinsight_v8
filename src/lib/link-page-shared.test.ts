import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT_ID,
  DEFAULT_STYLE_ID,
  INTERNAL_KINDS,
  ITEM_KINDS,
  KIND_LABEL,
  LINK_PAGE_LAYOUTS,
  LINK_PAGE_STYLES,
  RESERVED_PAGE_SLUGS,
  SLUG_MAX,
  SLUG_MIN,
  cleanItemUrl,
  cleanLabel,
  getLinkPageLayout,
  getLinkPageStyle,
  isItemKind,
  isPageStatus,
  isPubliclyVisible,
  linkPagePath,
  linkPageUrl,
  linkPageUrlForPrint,
  normalisePageSlug,
  pageSlugProblem,
  reorder,
} from "@/lib/link-page-shared";

/**
 * A link page is a public address a church prints in an Instagram bio, so the
 * two things worth being strict about are the address and the `href`.
 */

describe("the address", () => {
  it("tidies what somebody types", () => {
    expect(normalisePageSlug("  Grace Chapel  ")).toBe("grace-chapel");
    expect(normalisePageSlug("Grace_Chapel")).toBe("grace-chapel");
    expect(normalisePageSlug("Grace!!! Chapel???")).toBe("grace-chapel");
    expect(normalisePageSlug("grace---chapel")).toBe("grace-chapel");
    expect(normalisePageSlug("--grace--")).toBe("grace");
  });

  it("writes it the way it will be stored, so the field cannot lie", () => {
    // Whatever the field shows after tidying is what gets saved.
    for (const typed of ["Grace Chapel", "GRACE", "grace chapel 2026"]) {
      const once = normalisePageSlug(typed);
      expect(normalisePageSlug(once)).toBe(once);
    }
  });

  it("never produces something it would then reject for its shape", () => {
    /*
     * The trap this guards: tidying that leaves a trailing hyphen, or an
     * empty string, which the field then refuses while showing the value it
     * made itself.
     */
    for (const typed of [
      "Grace Chapel!",
      "a-",
      "---",
      "The Redeemed Christian Church of God, Victory Parish",
      "123",
      "ÀÁÂ grace",
    ]) {
      const s = normalisePageSlug(typed);
      if (!s) continue;
      expect(s.endsWith("-"), typed).toBe(false);
      expect(s.startsWith("-"), typed).toBe(false);
      expect(s.length, typed).toBeLessThanOrEqual(SLUG_MAX);
      expect(/^[a-z0-9][a-z0-9-]*$/.test(s), `${typed} -> ${s}`).toBe(true);
    }
  });

  it("accepts a reasonable one", () => {
    for (const s of ["grace", "grace-chapel", "rccg-victory", "youth2026"]) {
      expect(pageSlugProblem(s), s).toBeNull();
    }
  });

  it("explains what is wrong, in words a church can act on", () => {
    expect(pageSlugProblem("")).toMatch(/short word/i);
    expect(pageSlugProblem("a".repeat(SLUG_MIN - 1))).toMatch(/too short/i);
    expect(pageSlugProblem("a".repeat(SLUG_MAX + 1))).toMatch(/too long/i);
    expect(pageSlugProblem("-grace")).toMatch(/start with/i);
    expect(pageSlugProblem("grace chapel")).toMatch(/letters, numbers/i);
    expect(pageSlugProblem("grace-")).toMatch(/hyphen/i);
  });

  it("refuses the words that would read as the platform's own", () => {
    for (const s of ["admin", "flockinsight", "billing", "settings"]) {
      expect(pageSlugProblem(s), s).toMatch(/reserved/i);
    }
  });

  it("refuses its own namespace, so /hub/hub cannot exist", () => {
    expect(RESERVED_PAGE_SLUGS.has("hub")).toBe(true);
  });

  it("builds the path and the whole address", () => {
    expect(linkPagePath("grace")).toBe("/hub/grace");
    expect(linkPageUrl("https://flockinsight.com", "grace")).toBe(
      "https://flockinsight.com/hub/grace",
    );
    expect(linkPageUrl("https://flockinsight.com/", "grace")).toBe(
      "https://flockinsight.com/hub/grace",
    );
    expect(linkPageUrlForPrint("https://flockinsight.com", "grace")).toBe(
      "flockinsight.com/hub/grace",
    );
  });
});

describe("where a button points", () => {
  it("adds https to a bare host, because that is what people type", () => {
    expect(cleanItemUrl("grace.org")).toEqual({ url: "https://grace.org/" });
    expect(cleanItemUrl("  www.grace.org/give  ")).toEqual({
      url: "https://www.grace.org/give",
    });
  });

  it("keeps a full address as it is", () => {
    expect(cleanItemUrl("https://youtube.com/@grace")).toEqual({
      url: "https://youtube.com/@grace",
    });
    expect(cleanItemUrl("http://grace.org")).toEqual({ url: "http://grace.org/" });
  });

  it("allows email and telephone links", () => {
    expect(cleanItemUrl("mailto:hello@grace.org")).toEqual({
      url: "mailto:hello@grace.org",
    });
    expect(cleanItemUrl("tel:+2348012345678")).toEqual({
      url: "tel:+2348012345678",
    });
  });

  it("keeps the church's own pages as paths", () => {
    for (const p of ["/give/grace", "/f/welcome-card", "/c/grace", "/l/give"]) {
      expect(cleanItemUrl(p), p).toEqual({ url: p });
    }
  });

  it("REFUSES a script address", () => {
    /*
     * The one that matters. This string becomes an `href` on a page anybody
     * can open, so a member of staff who could put `javascript:` in a button
     * would have a way to run script in every visitor's browser — a stored
     * XSS reached through an ordinary-looking form field.
     */
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(document.cookie)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      const out = cleanItemUrl(bad);
      expect("error" in out, `${bad} was ACCEPTED as ${JSON.stringify(out)}`).toBe(
        true,
      );
    }
  });

  it("refuses a protocol-relative address dressed as a path", () => {
    // `//evil.com` looks like a path and is not one — it leaves the site.
    expect("error" in cleanItemUrl("//evil.com")).toBe(true);
    expect("error" in cleanItemUrl("//evil.com/give")).toBe(true);
  });

  it("refuses an empty or unparseable address", () => {
    for (const bad of ["", "   ", "http://", "https://"]) {
      expect("error" in cleanItemUrl(bad), JSON.stringify(bad)).toBe(true);
    }
  });

  it("never returns an href whose scheme is not one of the four allowed", () => {
    // A sweep, rather than a list: anything that comes back must be safe.
    const inputs = [
      "grace.org",
      "https://grace.org",
      "mailto:a@b.co",
      "tel:123",
      "/give/grace",
      "javascript:1",
      "data:,x",
      "//evil.com",
      "ftp://grace.org",
      "ws://grace.org",
    ];
    for (const i of inputs) {
      const out = cleanItemUrl(i);
      if (!("url" in out)) continue;
      const ok =
        out.url.startsWith("/") ||
        /^(https?|mailto|tel):/i.test(out.url);
      expect(ok, `${i} -> ${out.url}`).toBe(true);
    }
  });
});

describe("the button's name", () => {
  it("tidies whitespace and trims", () => {
    expect(cleanLabel("  Give   now  ")).toEqual({ label: "Give now" });
  });

  it("insists on one", () => {
    expect("error" in cleanLabel("   ")).toBe(true);
  });

  it("cuts an over-long one rather than refusing it", () => {
    const out = cleanLabel("x".repeat(500));
    expect("label" in out && out.label.length).toBe(80);
  });
});

describe("the styles", () => {
  it("has five, each with a unique id", () => {
    const ids = LINK_PAGE_STYLES.map((s) => s.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it("names and explains every one, so the picker is not a guessing game", () => {
    for (const s of LINK_PAGE_STYLES) {
      expect(s.name.length, s.id).toBeGreaterThan(2);
      expect(s.hint.length, s.id).toBeGreaterThan(10);
    }
  });

  it("falls back to the default for anything it does not know", () => {
    expect(getLinkPageStyle(null).id).toBe(DEFAULT_STYLE_ID);
    expect(getLinkPageStyle(undefined).id).toBe(DEFAULT_STYLE_ID);
    expect(getLinkPageStyle("").id).toBe(DEFAULT_STYLE_ID);
    expect(getLinkPageStyle("neon-explosion").id).toBe(DEFAULT_STYLE_ID);
  });

  it("has a default that actually exists", () => {
    expect(LINK_PAGE_STYLES.some((s) => s.id === DEFAULT_STYLE_ID)).toBe(true);
  });

  it("never decides the hue — only the arrangement", () => {
    /*
     * The rule that keeps five styles from becoming thirty-five. The church
     * has already chosen its colour in Settings; a style says light or dark,
     * flat or gradient, filled or plain, and nothing about which colour.
     */
    const backgrounds = new Set(LINK_PAGE_STYLES.map((s) => s.background));
    const buttons = new Set(LINK_PAGE_STYLES.map((s) => s.button));
    expect(backgrounds.size).toBeGreaterThan(2);
    expect(buttons.size).toBeGreaterThan(2);
    for (const s of LINK_PAGE_STYLES) {
      expect(["white", "dark", "tint", "brand-gradient"]).toContain(s.background);
      expect(["brand", "white", "outline", "plain"]).toContain(s.button);
    }
  });
});

describe("the layouts", () => {
  it("has three, each with a unique id", () => {
    const ids = LINK_PAGE_LAYOUTS.map((l) => l.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("falls back to the default", () => {
    expect(getLinkPageLayout("nonsense").id).toBe(DEFAULT_LAYOUT_ID);
    expect(getLinkPageLayout(null).id).toBe(DEFAULT_LAYOUT_ID);
  });

  it("has a default that actually exists", () => {
    expect(LINK_PAGE_LAYOUTS.some((l) => l.id === DEFAULT_LAYOUT_ID)).toBe(true);
  });
});

describe("the kinds of link", () => {
  it("labels every one", () => {
    for (const k of ITEM_KINDS) {
      expect(KIND_LABEL[k], k).toBeTruthy();
    }
  });

  it("offers every internal kind in the dropdown, and never 'external'", () => {
    // "external" is the typed-in case; it is not something to pick from a list
    // of the church's own pages.
    expect(INTERNAL_KINDS).not.toContain("external");
    for (const k of INTERNAL_KINDS) {
      expect(ITEM_KINDS, k).toContain(k);
    }
    // Every kind is either external or offered in the dropdown — a kind that
    // is neither could be stored and never created.
    for (const k of ITEM_KINDS) {
      expect(k === "external" || INTERNAL_KINDS.includes(k), k).toBe(true);
    }
  });

  it("recognises a kind, and refuses anything else", () => {
    expect(isItemKind("form")).toBe(true);
    expect(isItemKind("external")).toBe(true);
    expect(isItemKind("forms")).toBe(false);
    expect(isItemKind(null)).toBe(false);
    expect(isItemKind(7)).toBe(false);
  });
});

describe("moving an item", () => {
  const items = [
    { id: "a", position: 0 },
    { id: "b", position: 1 },
    { id: "c", position: 2 },
  ];

  it("moves one up", () => {
    expect(reorder(items, "b", "up").map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("moves one down", () => {
    expect(reorder(items, "b", "down").map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  it("does nothing at the ends, but still hands back a clean order", () => {
    expect(reorder(items, "a", "up").map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(reorder(items, "c", "down").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("always renumbers from zero with no gaps", () => {
    const out = reorder(items, "c", "up");
    expect(out.map((x) => x.position)).toEqual([0, 1, 2]);
  });

  it("repairs an order where positions have collided", () => {
    /*
     * Two items sharing a position is what a delete leaves behind, and a
     * naive swap of two equal numbers is a no-op — a button that visibly does
     * nothing. Renumbering on every move means the stored order is always
     * exactly the order on screen.
     */
    const messy = [
      { id: "a", position: 5 },
      { id: "b", position: 5 },
      { id: "c", position: 5 },
    ];
    const out = reorder(messy, "c", "up");
    expect(out.map((x) => x.position)).toEqual([0, 1, 2]);
    expect(out.map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  it("ignores an id it does not have, without losing anybody", () => {
    const out = reorder(items, "zzz", "up");
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(out.map((x) => x.position)).toEqual([0, 1, 2]);
  });

  it("does not mutate what it was given", () => {
    const original = items.map((x) => ({ ...x }));
    reorder(items, "b", "down");
    expect(items).toEqual(original);
  });
});

describe("whether the public can see it", () => {
  it("shows a published page", () => {
    expect(isPubliclyVisible("published")).toBe(true);
  });

  it("hides a draft, and anything it does not recognise", () => {
    expect(isPubliclyVisible("draft")).toBe(false);
    expect(isPubliclyVisible("")).toBe(false);
    expect(isPubliclyVisible("live")).toBe(false);
  });

  it("recognises the two statuses and nothing else", () => {
    expect(isPageStatus("draft")).toBe(true);
    expect(isPageStatus("published")).toBe(true);
    expect(isPageStatus("archived")).toBe(false);
    expect(isPageStatus(null)).toBe(false);
  });
});
