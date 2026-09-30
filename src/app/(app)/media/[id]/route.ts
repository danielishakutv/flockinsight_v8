import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { withAttachment } from "@/lib/cloudinary";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /media/[id]            -> serve / redirect to the asset
// GET /media/[id]?download=1 -> force a download (Content-Disposition / fl_attachment)
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
      url: media.url,
      title: media.title,
      originalName: media.originalName,
    })
    .from(media)
    .where(eq(media.id, id))
    .limit(1);

  if (!row) return new Response("Not found", { status: 404 });

  const name = row.originalName || row.title || "file";

  // Cloudinary-backed: redirect to the (optionally attachment-flagged) URL.
  if (row.provider === "cloudinary" && row.url) {
    const target = download ? withAttachment(row.url, name) : row.url;
    return Response.redirect(target, 302);
  }

  // Legacy db-backed bytes.
  if (!row.data) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": row.mime,
    "Cache-Control": "public, max-age=31536000, immutable",
  };
  if (download)
    headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(name)}"`;
  return new Response(new Uint8Array(row.data), { headers });
}
