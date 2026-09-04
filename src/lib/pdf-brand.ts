import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { getTheme } from "@/lib/church-themes";

/**
 * The church's own identity, for the top of a PDF.
 *
 * These documents get printed, filed and handed to trustees, so they should
 * look like the church's paperwork rather than ours: the church's logo, its
 * colours, its contact details. FlockInsight belongs in one quiet line at the
 * bottom.
 */

export type ChurchBrand = {
  name: string;
  /** PNG or JPEG bytes for the logo, or null to fall back to the mark. */
  logo: Buffer | null;
  /** Theme colours, used for the header band and accents. */
  primary: string;
  from: string;
  to: string;
  /** One line of address, phone and email — whatever the church has filled in. */
  contact: string | null;
};

/** What a caller must give us. Matches the church row's shape. */
export type BrandSource = {
  id: string;
  name: string;
  logo: string | null;
  theme: string | null;
  addressText?: string | null;
  city?: string | null;
  state?: string | null;
  publicPhone?: string | null;
  publicEmail?: string | null;
};

/**
 * react-pdf can only place PNG and JPEG. A church that uploaded a WebP or an
 * SVG gets the fallback mark rather than a broken document.
 */
const USABLE = new Set(["image/png", "image/jpeg", "image/jpg"]);

/** Generous for a logo, small enough that a wrong URL cannot exhaust memory. */
const MAX_LOGO_BYTES = 3 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 5000;

/**
 * Hosts a logo may be fetched from.
 *
 * church.logo is a free-text field any church admin can set, and signing up is
 * open, so without this the server would issue GET requests to wherever a
 * stranger pointed it — the other apps sharing this box on loopback, a cloud
 * metadata endpoint, anything on the private network. That is server-side
 * request forgery, and the image comes back to them inside a PDF they
 * download.
 *
 * An allowlist rather than a blocklist: we know exactly where our uploads
 * live. EXTRA_LOGO_HOSTS exists for a church whose logo is genuinely hosted
 * elsewhere, and is set by us, not by them.
 */
const ALLOWED_LOGO_HOSTS = new Set(
  [
    "res.cloudinary.com",
    ...(process.env.EXTRA_LOGO_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  ],
);

/**
 * True for an address that must never be reached from here: loopback, the
 * private ranges, link-local (which includes the cloud metadata service at
 * 169.254.169.254), and the unspecified address.
 */
export function isForbiddenAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 127 || a === 0 || a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }
  if (v === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) {
      return true;
    }
    // ::ffff:127.0.0.1 and friends
    const mapped = lower.split(":").pop();
    if (mapped && isIP(mapped) === 4) return isForbiddenAddress(mapped);
    return false;
  }
  return true; // not an IP at all — refuse rather than guess
}

/** Every address the host resolves to must be acceptable, not just the first. */
async function resolvesSomewhereSafe(hostname: string): Promise<boolean> {
  try {
    if (isIP(hostname)) return !isForbiddenAddress(hostname);
    const results = await lookup(hostname, { all: true, verbatim: true });
    if (results.length === 0) return false;
    return results.every((r) => !isForbiddenAddress(r.address));
  } catch {
    return false;
  }
}

/** Scheme and host check, split out so the refusals can be tested directly. */
export function isAllowedLogoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return ALLOWED_LOGO_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Logo bytes for a remote URL.
 *
 * Fetched here rather than handed to react-pdf as a URL so the timeout, the
 * size cap and the content-type check are ours. A PDF must never hang or fail
 * because a logo host is slow or has gone away.
 *
 * Redirects are refused outright. Following one would mean re-checking the
 * destination on every hop, and an allowed host that redirects to a private
 * address is precisely how this kind of guard gets walked around.
 */
async function fetchRemoteLogo(url: string): Promise<Buffer | null> {
  try {
    if (!isAllowedLogoUrl(url)) return null;
    const parsed = new URL(url);
    if (!(await resolvesSomewhereSafe(parsed.hostname))) return null;

    const res = await fetch(parsed, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "manual",
    });
    if (!res.ok) return null;

    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!USABLE.has(type.toLowerCase())) return null;

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_LOGO_BYTES) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    // Re-check: content-length can be absent or wrong.
    return buffer.byteLength > MAX_LOGO_BYTES ? null : buffer;
  } catch {
    return null;
  }
}

/**
 * Logo bytes for a locally stored image.
 *
 * Read straight from the media table. Going out over HTTP to our own server
 * would mean a request that can block on the very worker rendering this PDF.
 */
async function readLocalLogo(
  churchId: string,
  path: string,
): Promise<Buffer | null> {
  // "/media/<uuid>" or "/media/<uuid>?anything"
  const id = path.split("?")[0].split("/").filter(Boolean).pop();
  if (!id) return null;

  try {
    const [row] = await db
      .select({ mime: media.mime, data: media.data, url: media.url })
      .from(media)
      .where(and(eq(media.id, id), eq(media.churchId, churchId)))
      .limit(1);
    if (!row) return null;

    // A Cloudinary-backed row keeps its bytes elsewhere.
    if (!row.data) return row.url ? fetchRemoteLogo(row.url) : null;
    if (!USABLE.has((row.mime ?? "").toLowerCase())) return null;
    return row.data.byteLength > MAX_LOGO_BYTES ? null : row.data;
  } catch {
    return null;
  }
}

function contactLine(c: BrandSource): string | null {
  const place = [c.addressText, c.city, c.state]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");
  const parts = [place, c.publicPhone?.trim(), c.publicEmail?.trim()].filter(
    Boolean,
  );
  return parts.length ? parts.join("  ·  ") : null;
}

/**
 * Assemble everything a PDF needs to look like this church's document.
 *
 * Never throws and never returns nothing usable: a missing or broken logo
 * simply falls back to the mark, and an unknown theme falls back to the
 * default. A document that renders plainly beats one that fails.
 */
export async function getChurchBrand(
  church: BrandSource,
): Promise<ChurchBrand> {
  const theme = getTheme(church.theme);

  let logo: Buffer | null = null;
  const raw = church.logo?.trim();
  if (raw) {
    logo = raw.startsWith("http")
      ? await fetchRemoteLogo(raw)
      : await readLocalLogo(church.id, raw);
  }

  return {
    name: church.name,
    logo,
    primary: theme.primary,
    from: theme.from,
    to: theme.to,
    contact: contactLine(church),
  };
}
