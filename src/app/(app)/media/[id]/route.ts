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
