/**
 * Link pages: one address that holds all the others.
 *
 * The thing a church actually wants when it says "put the link in the bio" —
 * `flockinsight.com/hub/grace` with the giving page, this Sunday's form, the
 * livestream and the WhatsApp group on it, in the order they choose.
 *
 * Pure and client-safe: no database, no request, no React. The editor, the
 * server action and the public page all agree about what a slug is, what a
 * style is, and what counts as a usable address, because all three ask this
 * file. The styles are data rather than CSS so the editor can draw a true preview
 * of each one without rendering the page.
 */

/* ============================================================
 * The slug
 * ========================================================== */

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

/**
 * Words a church cannot take.
 *
 * `/hub/` is its own namespace, so nothing here can collide with an app route.
 * These are the ones that would mislead — a page at `/hub/admin` or
 * `/hub/flockinsight` reads as belonging to the platform rather than to a
 * church, which is the shape every impersonation takes.
 */
export const RESERVED_PAGE_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "new",
  "edit",
  "delete",
  "settings",
  "superadmin",
  "support",
  "help",
  "flockinsight",
  "login",
  "signin",
  "signup",
  "billing",
  "pay",
  "payment",
  "null",
  "undefined",
  "hub",
]);

/**
 * Tidy a typed slug into the form it is stored in.
 *
 * Same rules as a short link code, and for the same reason: this address gets
 * read off an Instagram bio and typed in by hand. Lower case, no punctuation
 * beyond a hyphen, no runs of hyphens. Does NOT validate — `slugProblem` does
 * that, so the field can tidy as somebody types without rejecting a word they
 * have not finished.
 */
export function normalisePageSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX);
}

/** What is wrong with this slug, in words a church can act on. Null = fine. */
export function pageSlugProblem(slug: string): string | null {
  if (!slug) return "Choose a short word for the address.";
  if (slug.length < SLUG_MIN) {
    return `Too short — at least ${SLUG_MIN} characters.`;
  }
  if (slug.length > SLUG_MAX) {
    return `Too long — at most ${SLUG_MAX} characters.`;
  }
  if (!/^[a-z0-9]/.test(slug)) return "Start with a letter or a number.";
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return "Letters, numbers and hyphens only.";
  }
  if (slug.endsWith("-")) return "Cannot end with a hyphen.";
  if (RESERVED_PAGE_SLUGS.has(slug)) {
    return "That word is reserved. Try your church's name instead.";
  }
  return null;
}

/** `/hub/<slug>` — the path, with no host. */
export function linkPagePath(slug: string): string {
  return `/hub/${slug}`;
}

/** The whole address, for copying and for a QR code. */
export function linkPageUrl(baseUrl: string, slug: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${linkPagePath(slug)}`;
}

/** Without the scheme, for printing — `flockinsight.com/hub/grace`. */
export function linkPageUrlForPrint(baseUrl: string, slug: string): string {
  return linkPageUrl(baseUrl, slug).replace(/^https?:\/\//, "");
}

/* ============================================================
 * Where an item points
 * ========================================================== */

/**
 * The kinds of thing that can be on the page.
 *
 * `external` is anything the church typed. Everything else came from the
 * dropdown and names which of the church's own pages it is, which is what
 * lets the editor group them, filter them, and draw the right icon — and what
 * lets a later version notice that a form has been unpublished and say so
 * rather than leaving a dead button on a public page.
 */
export const ITEM_KINDS = [
  "external",
  "church",
  "form",
  "giving",
  "contribution",
  "livestream",
  "welcome",
  "signup",
  "event",
  "shortLink",
] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];

/** The filter in the "add an internal link" dropdown, in the order it shows. */
export const INTERNAL_KINDS: readonly ItemKind[] = [
  "church",
  "giving",
  "form",
  "contribution",
  "event",
  "livestream",
  "welcome",
  "signup",
  "shortLink",
];

export const KIND_LABEL: Readonly<Record<ItemKind, string>> = {
  external: "Other link",
  church: "Church page",
  form: "Form",
  giving: "Giving page",
  contribution: "Group contribution",
  livestream: "Livestream",
  welcome: "First-timer welcome",
  signup: "Member sign-up",
  event: "Event",
  shortLink: "Short link",
};

export function isItemKind(v: unknown): v is ItemKind {
  return typeof v === "string" && (ITEM_KINDS as readonly string[]).includes(v);
}

/* ============================================================
 * The address an item points at
 * ========================================================== */

export const LABEL_MAX = 80;
export const DESCRIPTION_MAX = 140;
export const TITLE_MAX = 80;
export const TAGLINE_MAX = 160;
export const MAX_ITEMS = 50;

/**
 * Tidy a typed address, and refuse the ones that are a hazard.
 *
 * Returns the address to store, or an error. Two things matter here and
 * neither is cosmetic:
 *
 *  - **A church types `grace.org`, not `https://grace.org`.** Refusing that
 *    would make the field feel broken, so a bare host gets `https://`.
 *  - **`javascript:` and `data:` are refused.** This string is rendered as an
 *    `href` on a public page that anybody can open. A staff member with
 *    `links.manage` who can put `javascript:` in a button has a way to run
 *    script in the browser of every visitor to that page, which is a stored
 *    XSS with extra steps. Only http, https, mailto and tel are allowed, and
 *    a site-relative path for the church's own pages.
 */
export function cleanItemUrl(input: string): { url: string } | { error: string } {
  const raw = input.trim();
  if (!raw) return { error: "Where should this link go?" };

  // The church's own pages, added from the dropdown.
  if (raw.startsWith("/")) {
    if (raw.startsWith("//")) {
      // `//evil.com` is a protocol-relative URL, not a path on this site.
      return { error: "That does not look like a page on your site." };
    }
    return { url: raw };
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { error: "That does not look like a web address." };
  }

  const scheme = parsed.protocol.toLowerCase();
  if (!["http:", "https:", "mailto:", "tel:"].includes(scheme)) {
    return {
      error: "Only web addresses, email addresses and phone numbers can be linked.",
    };
  }
  if ((scheme === "http:" || scheme === "https:") && !parsed.hostname) {
    return { error: "That does not look like a web address." };
  }

  return { url: parsed.toString() };
}

/** Trim a label to something that fits a button, or say it is missing. */
export function cleanLabel(input: string): { label: string } | { error: string } {
  const label = input.trim().replace(/\s+/g, " ").slice(0, LABEL_MAX);
  if (!label) return { error: "Give the button a name." };
  return { label };
}

/* ============================================================
 * The styles
 * ========================================================== */

/**
 * A style, as data.
 *
 * Not CSS, because the editor has to draw a swatch of each one beside its name
 * and the public page has to render it — and two hand-written copies of the
 * same five designs is how a preview comes to lie about the result.
 *
 * Every colour is either a fixed neutral or `brand`, which resolves to the
 * church's own theme colour from `lib/church-themes.ts`. That is the whole
 * reason there are only five: the church has already chosen its colour, so a
 * style decides the ARRANGEMENT — light or dark, flat or gradient, filled
 * buttons or plain rules — and never the hue. Five arrangements times seven
 * church colours is thirty-five pages that all look deliberate.
 */
export type LinkPageStyle = {
  id: string;
  name: string;
  /** One line in the picker, so the names are not a guessing game. */
  hint: string;
  /** The page behind everything. `brand-gradient` uses the church's colours. */
  background: "white" | "dark" | "tint" | "brand-gradient";
  /** The buttons. */
  button: "brand" | "white" | "outline" | "plain";
  /** Rounded corners, in Tailwind's scale. */
  radius: "full" | "xl" | "none";
  /** Whether a button carries a shadow. */
  shadow: boolean;
};

export const LINK_PAGE_STYLES: readonly LinkPageStyle[] = [
  {
    id: "classic",
    name: "Classic",
    hint: "White page, your colour on the buttons.",
    background: "white",
    button: "brand",
    radius: "full",
    shadow: true,
  },
  {
    id: "dark",
    name: "Dark",
    hint: "Near-black page, light buttons.",
    background: "dark",
    button: "white",
    radius: "full",
    shadow: false,
  },
  {
    id: "bold",
    name: "Bold",
    hint: "Your colours across the whole page.",
    background: "brand-gradient",
    button: "white",
    radius: "xl",
    shadow: true,
  },
  {
    id: "soft",
    name: "Soft",
    hint: "A pale wash of your colour, gentle edges.",
    background: "tint",
    button: "outline",
    radius: "xl",
    shadow: false,
  },
  {
    id: "minimal",
    name: "Minimal",
    hint: "Plain text links and thin rules. Nothing else.",
    background: "white",
    button: "plain",
    radius: "none",
    shadow: false,
  },
];

export const DEFAULT_STYLE_ID = "classic";

export function getLinkPageStyle(id: string | null | undefined): LinkPageStyle {
  return (
    LINK_PAGE_STYLES.find((s) => s.id === id) ??
    LINK_PAGE_STYLES.find((s) => s.id === DEFAULT_STYLE_ID)!
  );
}

/* ============================================================
 * How the items are arranged
 * ========================================================== */

export type LinkPageLayout = {
  id: string;
  name: string;
  hint: string;
};

/**
 * Three, and the difference between them is how much each item says.
 *
 * Stored separately from the style so a church can have a dark page with
 * descriptions, or a white one without — five styles times three layouts, from
 * two dropdowns, instead of fifteen named designs nobody can tell apart.
 */
export const LINK_PAGE_LAYOUTS: readonly LinkPageLayout[] = [
  {
    id: "buttons",
    name: "Buttons",
    hint: "Full-width buttons, name only. The usual thing.",
  },
  {
    id: "cards",
    name: "Cards",
    hint: "Roomier, with a line of explanation under each name.",
  },
  {
    id: "list",
    name: "List",
    hint: "Compact rows. Best when there are a lot of links.",
  },
];

export const DEFAULT_LAYOUT_ID = "buttons";

export function getLinkPageLayout(id: string | null | undefined): LinkPageLayout {
  return (
    LINK_PAGE_LAYOUTS.find((l) => l.id === id) ??
    LINK_PAGE_LAYOUTS.find((l) => l.id === DEFAULT_LAYOUT_ID)!
  );
}

/* ============================================================
 * Ordering
 * ========================================================== */

export type Orderable = { id: string; position: number };

/**
 * Move one item up or down, and hand back every position that changed.
 *
 * Returns the whole new order rather than a swap, because positions in the
 * database drift — two items can end up sharing a position after a delete, and
 * a swap of equal numbers is a no-op that looks like a broken button.
 * Renumbering from zero on every move means the stored order is always exactly
 * the order on screen.
 */
export function reorder<T extends Orderable>(
  items: readonly T[],
  id: string,
  direction: "up" | "down",
): T[] {
  const sorted = [...items].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  );
  const i = sorted.findIndex((x) => x.id === id);
  if (i === -1) return sorted.map((x, n) => ({ ...x, position: n }));

  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= sorted.length) {
    // Already at the end. Still renumbered, so a wonky order repairs itself.
    return sorted.map((x, n) => ({ ...x, position: n }));
  }

  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  return sorted.map((x, n) => ({ ...x, position: n }));
}

/* ============================================================
 * Status
 * ========================================================== */

export const PAGE_STATUSES = ["draft", "published"] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

export function isPageStatus(v: unknown): v is PageStatus {
  return v === "draft" || v === "published";
}

/**
 * Is this page visible to the public right now?
 *
 * A draft is not. The reason it is a function and not a comparison is that
 * `/hub/<slug>` must give a draft the SAME answer it gives a slug nobody has
 * ever taken — a 404, not "this exists but is not published" — so that the
 * address of a page a church is still writing is not something a stranger can
 * confirm the existence of.
 */
export function isPubliclyVisible(status: string): boolean {
  return status === "published";
}
