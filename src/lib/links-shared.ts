/**
 * Short links: the rules, with no database and no request.
 *
 * Pure and client-safe, so the form that types a code and the action that
 * saves it agree about what a code is. The interesting decisions are all about
 * a link being read off a printed poster and typed in by hand, which is a very
 * different thing from a link being clicked.
 */

/* ============================================================
 * The code
 * ========================================================== */

/**
 * The alphabet a generated code is drawn from.
 *
 * No `0`, `o`, `1`, `l` or `i`. A short link exists to be put on a poster, a
 * screen at the front, or spoken from a pulpit — and the one thing certain to
 * happen is somebody typing it wrong. Removing the five characters that are
 * mistaken for each other costs almost nothing in combinations (31 characters
 * still gives 28 million six-character codes) and removes the commonest reason
 * a short link does not work for the person who actually needed it.
 *
 * Lowercase only, for the same reason: nobody can tell case from a poster.
 */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export const CODE_MIN = 3;
export const CODE_MAX = 40;

/**
 * Codes that cannot be used.
 *
 * `/l/` is its own namespace so nothing here can collide with an app route —
 * these are the words that would be confusing, misleading, or an invitation to
 * impersonate the platform itself.
 */
export const RESERVED_CODES = new Set([
  "admin",
  "api",
  "app",
  "login",
  "logout",
  "signin",
  "signup",
  "register",
  "password",
  "reset",
  "verify",
  "billing",
  "pay",
  "payment",
  "wallet",
  "account",
  "settings",
  "superadmin",
  "support",
  "help",
  "flockinsight",
  "null",
  "undefined",
  "new",
  "edit",
  "delete",
  "qr",
  "l",
]);

/**
 * Tidy a typed code into the form it is stored in.
 *
 * Case-folded and stripped of the punctuation people add when writing a link
 * down, so `Grace Sunday!` and `grace-sunday` reach the same place. Does not
 * validate — `codeProblem` does that, and keeping them apart means a field can
 * tidy as you type without rejecting a half-finished word.
 */
export function normaliseCode(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, CODE_MAX);
}

/** What is wrong with this code, as a sentence, or null if nothing is. */
export function codeProblem(code: string): string | null {
  if (code.length === 0) return "Give the link a short code.";
  if (code.length < CODE_MIN) {
    return `A code needs at least ${CODE_MIN} characters, so it cannot be mistyped into somebody else's.`;
  }
  if (code.length > CODE_MAX) return `A code can be at most ${CODE_MAX} characters.`;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(code)) {
    return "Use lowercase letters, numbers and hyphens only, starting and ending with a letter or number.";
  }
  if (RESERVED_CODES.has(code)) {
    return `“${code}” is reserved, because a link with that word in it would look like it came from us rather than from your church.`;
  }
  return null;
}

/** A random code, from the unambiguous alphabet. */
export function randomCode(length = 6): string {
  let out = "";
  const bytes = randomBytes(length);
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Random bytes from the platform's own generator where there is one.
 *
 * `Math.random` is predictable, and a predictable short code can be guessed —
 * which matters because a church's unlisted link (an order of service, a
 * safeguarding form) is protected by nothing except the code being unknown.
 * The fallback exists so this file stays importable anywhere, and is never
 * reached in the browser or in Node.
 */
function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < length; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/* ============================================================
 * The destination
 * ========================================================== */

export const DESTINATION_MAX = 2000;

/**
 * Schemes a destination may use.
 *
 * `javascript:` and `data:` are the reason this is a list of what is allowed
 * rather than a list of what is not: a short link is a redirect somebody else
 * clicks, so a `javascript:` destination would be a script running on our
 * domain, under our name, from a link a church handed out. `tel:` and
 * `mailto:` are genuinely useful on a poster and carry no such risk.
 */
const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

export type DestinationResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Check and tidy a destination.
 *
 * `ownHost` is this installation's own hostname, which is what lets a link
 * pointing at another short link be refused — a→b→a is a redirect loop, and
 * the browser's own cap on redirects is not a diagnosis anybody can read.
 */
export function checkDestination(
  input: string,
  ownHost?: string | null,
): DestinationResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Add the address this link should open." };
  if (raw.length > DESTINATION_MAX) {
    return { ok: false, error: `That address is too long (over ${DESTINATION_MAX} characters).` };
  }

  // A bare domain is what people paste; give it a scheme before parsing, or
  // `new URL` reads "flockinsight.com/give" as the scheme "flockinsight.com".
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return {
      ok: false,
      error: "That does not look like a web address. It should look like flockinsight.com/give.",
    };
  }

  if (!ALLOWED_SCHEMES.has(url.protocol.toLowerCase())) {
    return {
      ok: false,
      error: `A short link can point to a web page, an email address or a phone number — not to “${url.protocol.replace(":", "")}”.`,
    };
  }

  if ((url.protocol === "http:" || url.protocol === "https:") && !url.hostname) {
    return { ok: false, error: "That address has no website in it." };
  }

  if (ownHost && url.hostname.toLowerCase() === ownHost.toLowerCase()) {
    const path = url.pathname.toLowerCase();
    if (path === "/l" || path.startsWith("/l/")) {
      return {
        ok: false,
        error:
          "This would point one short link at another, which can loop. Point it at the real address instead.",
      };
    }
  }

  return { ok: true, url: url.toString() };
}

/* ============================================================
 * Presentation
 * ========================================================== */

/** The full short link, as it would be printed. */
export function shortUrl(baseUrl: string, code: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/l/${code}`;
}

/** The short link without its scheme, which is how it goes on a poster. */
export function shortUrlForPrint(baseUrl: string, code: string): string {
  return shortUrl(baseUrl, code).replace(/^https?:\/\//, "");
}

/**
 * A readable version of a destination, for a table.
 *
 * Trims the scheme and any trailing slash, keeps the host whole, and shortens
 * the middle of a long path rather than its end — the end of a URL is usually
 * the part that says what it is.
 */
export function prettyDestination(url: string, max = 54): string {
  const trimmed = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (trimmed.length <= max) return trimmed;
  const slash = trimmed.indexOf("/");
  if (slash === -1 || slash > max - 12) return `${trimmed.slice(0, max - 1)}…`;
  const host = trimmed.slice(0, slash);
  const tail = trimmed.slice(trimmed.length - (max - host.length - 2));
  return `${host}/…${tail}`;
}

/* ============================================================
 * Status
 * ========================================================== */

export const LINK_STATUSES = ["active", "paused", "archived"] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

export const LINK_STATUS_LABEL: Record<LinkStatus, string> = {
  active: "Live",
  paused: "Paused",
  archived: "Archived",
};

export const LINK_STATUS_TONE: Record<LinkStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  paused: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  archived: "bg-muted text-muted-foreground",
};

/**
 * Why a link is not taking people anywhere, in the words a visitor sees.
 *
 * One state per reason. "This link is not available" covering four different
 * situations means the church cannot tell a paused link from an expired one
 * from a code that was never theirs, and nor can whoever rings them about it.
 */
export type LinkRefusal = "missing" | "paused" | "archived" | "expired";

export const REFUSAL_HEADING: Record<LinkRefusal, string> = {
  missing: "This link does not exist",
  paused: "This link is paused",
  archived: "This link has been retired",
  expired: "This link has expired",
};

export const REFUSAL_BODY: Record<LinkRefusal, string> = {
  missing:
    "Check the address — a short link is a few letters and numbers, and one wrong character leads nowhere.",
  paused:
    "The church that made it has turned it off for now. It may come back, so it is worth trying again later.",
  archived: "The church that made it has retired it. There may be a newer link.",
  expired: "It was set to stop working on a certain date, and that date has passed.",
};

/** Why this link will not redirect, given its row and the time. */
export function refusalFor(
  link: { status: string; expiresAt: Date | string | null },
  now: Date = new Date(),
): LinkRefusal | null {
  if (link.status === "paused") return "paused";
  if (link.status === "archived") return "archived";
  if (link.expiresAt) {
    const expires = link.expiresAt instanceof Date ? link.expiresAt : new Date(link.expiresAt);
    // An unparseable date must not silently mean "never expires": a link the
    // church asked to stop working would keep working for ever.
    if (Number.isNaN(expires.getTime())) return "expired";
    if (expires.getTime() <= now.getTime()) return "expired";
  }
  return null;
}

/* ============================================================
 * Clicks
 * ========================================================== */

/** The buckets a click is counted into. One table, one statement per click. */
export const STAT_BUCKETS = ["day", "source", "device"] as const;
export type StatBucket = (typeof STAT_BUCKETS)[number];

/**
 * Where a click came from, as a host or one of two words.
 *
 * `direct` is a click with no referrer, which is what a QR code scan and a
 * typed link both look like — and both are the point of this feature, so they
 * are the bucket that matters most. `qr` cannot be distinguished from `direct`
 * by a referrer at all; it is marked by a parameter the QR carries instead.
 */
export function sourceOf(referrer: string | null, isQr: boolean): string {
  if (isQr) return "qr";
  if (!referrer) return "direct";
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    return host.slice(0, 120) || "direct";
  } catch {
    return "direct";
  }
}

/**
 * Phone, tablet or computer, from the user agent.
 *
 * Three buckets, because that is the width of the decision it informs: whether
 * the thing being linked to needs to work on a phone. Anything finer is a
 * guess dressed up as data, and user-agent parsing is wrong often enough that
 * a fourth bucket would mostly collect mistakes.
 */
export function deviceOf(userAgent: string | null): "phone" | "tablet" | "computer" {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "computer";
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/.test(ua)) return "phone";
  return "computer";
}

export const DEVICE_LABEL: Record<string, string> = {
  phone: "Phone",
  tablet: "Tablet",
  computer: "Computer",
};

/** The query parameter a QR code adds, so a scan can be told from a click. */
export const QR_PARAM = "s";
export const QR_PARAM_VALUE = "qr";

/** A short link with the marker that identifies a scan of it. */
export function qrTargetUrl(baseUrl: string, code: string): string {
  return `${shortUrl(baseUrl, code)}?${QR_PARAM}=${QR_PARAM_VALUE}`;
}
