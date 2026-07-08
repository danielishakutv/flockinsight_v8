import { requireSuperAdmin } from "@/lib/session";
import { isCloudinaryConfigured, uploadToCloudinary } from "@/lib/cloudinary";

export const runtime = "nodejs";
export const maxDuration = 60;

// Blog images are authored by the platform operator (superadmin) and live at
// the platform level — they are NOT tied to a church and don't count against
// any church's storage quota, so this endpoint is separate from
// /api/media/upload (which is church-scoped via requireChurch).
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB (client already compresses to WebP)

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /api/superadmin/blog/upload  (multipart: file)  -> { ok, url }
export async function POST(request: Request) {
  await requireSuperAdmin();

  if (!isCloudinaryConfigured())
    return json(
      { ok: false, error: "Image uploads aren't configured yet." },
      503,
    );

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return json({ ok: false, error: "Could not read the upload." }, 400);
  }

  if (!file) return json({ ok: false, error: "No file uploaded." }, 400);
  if (!file.type.startsWith("image/"))
    return json({ ok: false, error: "Please upload an image." }, 400);
  if (file.size > MAX_BYTES)
    return json({ ok: false, error: "That image is too large." }, 400);

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const asset = await uploadToCloudinary(buf, {
      resourceType: "image",
      folder: "flockinsight/blog",
      filename: file.name,
    });
    return json({ ok: true, url: asset.url });
  } catch (e) {
    console.error("[superadmin/blog/upload] failed", e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Upload failed." },
      500,
    );
  }
}
