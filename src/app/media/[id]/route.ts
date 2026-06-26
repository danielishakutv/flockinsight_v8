import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /media/[id] — serve an uploaded image. The id is a random UUID and the
// bytes never change, so we can cache it forever (immutable).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });

  const [row] = await db
    .select({ mime: media.mime, data: media.data })
    .from(media)
    .where(eq(media.id, id))
    .limit(1);

  if (!row) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
