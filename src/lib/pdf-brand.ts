import "server-only";
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
 * Logo bytes for a Cloudinary (or any http) URL.
 *
 * Fetched here rather than handed to react-pdf as a URL so the timeout, the
 * size cap and the content-type check are ours. A PDF must never hang or fail
 * because a logo host is slow or has gone away.
 */
async function fetchRemoteLogo(url: string): Promise<Buffer | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
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
