import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { withAttachment } from "@/lib/cloudinary";
import { fileSize, localMimeEssence, parseRange, streamFile } from "@/lib/media-store";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /media/[id]            -> serve / redirect to the asset
// GET /media/[id]?download=1 -> force a download (Content-Disposition / fl_attachment)
//
// Audio and video opened as a page (a shared link tapped in WhatsApp) are sent
// on to /watch/[id], the player page; the media elements there fetch from here.
//
// The id is a random UUID and the bytes never change, so responses are
// cacheable forever. Cloudinary-backed rows redirect to the optimised remote
// asset; legacy db-backed rows are streamed from Postgres.
//
// DELIBERATELY UNAUTHENTICATED, and worth saying out loud because it is the
// only route under (app) that is.
//
// A route handler is not wrapped by the (app) layout, so requireChurch() never
// runs here even though the path sits inside it. That is the intent rather
// than an oversight: the media library has a "Copy link" button so a church
// can put a sermon recording in a WhatsApp group or an email, and those
// readers have no account. The Cloudinary URL behind most rows is itself
// unsigned and public, so gating this route would protect nothing but the
// legacy database-backed bytes.
//
// What actually guards a file is that a v4 UUID is not guessable — unlisted,
// not private. The library says so beside the button, because a church that
// believes a link is team-only will share it as though it were.
//
// If private media is ever needed, this is the place: require a session, scope
// the row to the caller's church, and move Cloudinary to signed URLs. Two of
// those three are here; the third is the reason it has not been done.
/**
 * Headers every byte served from this origin carries.
 *
 * This route answers on flockinsight.com itself, unauthenticated, with bytes a
 * church uploaded. So what the browser does with them is decided here and not
 * left to the file: nosniff so a type is never guessed, and a sandbox CSP so
 * that even a response a browser DID decide to render as a document could run
 * no script and reach nothing.
 */
/*
 * `allow-same-origin` is what lets a link opened straight in a tab play.
 *
 * A browser shows a bare video or audio URL as a document of its own with one
 * <video> in it, and that element then fetches this same URL. A bare `sandbox`
 * gives that document an opaque origin ("null"), so Chrome refused the fetch
 * as cross-origin and every recording opened from a link showed a dead player
 * — while the same file played in the library, where it is a subresource of
 * the app's own page and this header never applies. Without `allow-scripts`
 * nothing can run in the document either way, which was the point.
 */
const LOCKDOWN: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "sandbox allow-same-origin; default-src 'none'; media-src 'self'; img-src 'self'",
};

/**
 * Whether this request is somebody opening the link in a tab, as opposed to a
 * <video> or <audio> element (or a download) fetching the bytes.
 *
 * Fetch metadata says so outright; every current browser sends it. One that
 * does not just gets the file, as before.
 */
function isPageVisit(req: Request): boolean {
  return req.headers.get("sec-fetch-dest") === "document";
}

function isAudioOrVideo(mime: string | null): boolean {
  return /^(audio|video)\//i.test(String(mime ?? "").trim());
}

/** Types the legacy database-backed rows may be served as, inline. */
const LEGACY_INLINE = /^(image\/(png|jpe?g|gif|webp|avif|heic|heif)|application\/pdf)$/;

function attachment(name: string): string {
  return `attachment; filename="${encodeURIComponent(name)}"`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });

  const download = new URL(req.url).searchParams.get("download") != null;

  const [row] = await db
    .select({
      mime: media.mime,
      data: media.data,
      provider: media.provider,
      storageKey: media.storageKey,
      url: media.url,
      title: media.title,
      originalName: media.originalName,
    })
    .from(media)
    .where(eq(media.id, id))
    .limit(1);

  if (!row) return new Response("Not found", { status: 404 });

  const name = row.originalName || row.title || "file";

  /*
   * A recording or a sermon opened as a page goes to the player page, which
   * carries the title, the church and the controls. The bytes stay here for
   * the player itself, for downloads, and for anything that embeds them.
   */
  if (!download && isPageVisit(req) && isAudioOrVideo(row.mime)) {
    return new Response(null, {
      status: 302,
      headers: { Location: `/watch/${id}`, "Cache-Control": "no-store" },
    });
  }

  // Cloudinary-backed: redirect to the (optionally attachment-flagged) URL.
  if (row.provider === "cloudinary" && row.url) {
    const target = download ? withAttachment(row.url, name) : row.url;
    return Response.redirect(target, 302);
  }

  /*
   * Stored on this server's own disk — video and audio.
   *
   * Range support is not optional here. Without a 206 a browser cannot seek, so
   * a two-hour service becomes a file you may only watch from the beginning,
   * and Safari refuses to start it at all. Every player sends a Range request
   * for video; answering 200 with the whole file is what "the video does not
   * work on iPhone" actually means.
   */
  if (row.provider === "local" && row.storageKey) {
    const size = await fileSize(row.storageKey);
    if (size === null) {
      // The row says there is a file and there is not. Said out loud, because
      // silently 404ing a recording somebody is looking for is how a storage
      // bug stays invisible.
      console.error(
        `[media] row ${id} points at a missing file: ${row.storageKey}`,
      );
      return new Response("Not found", { status: 404 });
    }

    /*
     * The type is re-checked on the way OUT as well as on the way in. A row
     * written before the allow-list existed may hold whatever a browser sent —
     * "video/mp4, text/html" was enough to have a page run script on this
     * origin. Anything that is not a plain allowed audio/video type is served
     * as an opaque download instead.
     */
    const safe = localMimeEssence(row.mime);
    const common: Record<string, string> = {
      ...LOCKDOWN,
      "Content-Type": safe ?? "application/octet-stream",
      // The bytes behind a given id never change — a transcode writes a NEW key
      // and updates the row — so this is safe to cache hard.
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
      // The same URL answers a page visit with a redirect to the player.
      Vary: "Sec-Fetch-Dest",
    };
    if (download || !safe) common["Content-Disposition"] = attachment(name);

    const range = parseRange(req.headers.get("range"), size);
    if (range) {
      return new Response(streamFile(row.storageKey, { start: range.start, end: range.end }), {
        status: 206,
        headers: {
          ...common,
          "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
          "Content-Length": String(range.end - range.start + 1),
        },
      });
    }

    // An unsatisfiable range must say so rather than quietly sending everything.
    if (req.headers.get("range") && !range) {
      return new Response(null, {
        status: 416,
        headers: { ...LOCKDOWN, "Content-Range": `bytes */${size}` },
      });
    }

    return new Response(streamFile(row.storageKey), {
      headers: { ...common, "Content-Length": String(size) },
    });
  }

  // Legacy db-backed bytes.
  if (!row.data) return new Response("Not found", { status: 404 });
  /*
   * Legacy rows are images and PDFs from before Cloudinary. Only those exact
   * types are shown inline; anything else — an SVG, which is a document that
   * can carry script, or a type with a second one smuggled after a comma — is
   * a download, whatever the row says.
   */
  const essence = String(row.mime ?? "").split(";")[0].trim().toLowerCase();
  const inline = LEGACY_INLINE.test(essence);
  const headers: Record<string, string> = {
    // Except the CSP for a PDF: Chrome will not open its built-in PDF viewer
    // in a sandboxed document and shows a blank page. A PDF cannot run script
    // on this origin either way; nosniff still holds.
    ...(essence === "application/pdf"
      ? { "X-Content-Type-Options": "nosniff" }
      : LOCKDOWN),
    "Content-Type": inline ? essence : "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
  };
  if (download || !inline) headers["Content-Disposition"] = attachment(name);
  return new Response(new Uint8Array(row.data), { headers });
}
