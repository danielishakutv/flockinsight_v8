import { db } from "@/db";
import { media } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";

// Images are compressed in the browser before upload, so this ceiling is just
// an abuse guard — a normal compressed logo/photo is well under 1 MB.
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/webp", "image/jpeg", "image/png"]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /api/media  (multipart: file, kind)  ->  { ok, url }
export async function POST(request: Request) {
  const { church } = await requireChurch();
  if (!(await can("settings.manage")))
    return json({ ok: false, error: "You can't upload media." }, 403);

  let file: File | null = null;
  let kind = "photo";
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    const k = form.get("kind");
    if (typeof k === "string" && ["logo", "cover", "photo"].includes(k)) kind = k;
  } catch {
    return json({ ok: false, error: "Could not read the upload." }, 400);
  }

  if (!file) return json({ ok: false, error: "No file uploaded." }, 400);
  if (!ALLOWED.has(file.type))
    return json({ ok: false, error: "Only JPG, PNG or WebP images." }, 400);
  if (file.size > MAX_BYTES)
    return json({ ok: false, error: "Image is too large." }, 400);

  const buf = Buffer.from(await file.arrayBuffer());

  const [row] = await db
    .insert(media)
    .values({
      churchId: church.id,
      kind,
      mime: file.type,
      size: buf.length,
      data: buf,
    })
    .returning({ id: media.id });

  return json({ ok: true, url: `/media/${row.id}` });
}
