import { compress } from "@/components/settings/image-upload";

/**
 * Compress (client) then upload a blog image to the superadmin-only endpoint.
 * Unlike /api/media/upload this is platform-level (no church, no quota).
 * Returns the Cloudinary URL to embed.
 */
export async function uploadBlogImage(file: File, maxDim: number): Promise<string> {
  const blob = await compress(file, maxDim);
  const fd = new FormData();
  fd.append(
    "file",
    blob,
    (file.name?.replace(/\.[^.]+$/, "") || "image") + ".webp",
  );
  const res = await fetch("/api/superadmin/blog/upload", {
    method: "POST",
    body: fd,
  });
  const data = (await res.json().catch(() => null)) as
    | { ok: true; url: string }
    | { ok: false; error: string }
    | null;
  if (!data || !data.ok) throw new Error(data?.error || "Upload failed");
  return data.url;
}
