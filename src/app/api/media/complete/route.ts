import { db } from "@/db";
import { media } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { fetchCloudinaryAsset, type ResourceType } from "@/lib/cloudinary";
import { permForKind, MEDIA_KINDS, type MediaKind } from "@/lib/media";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * POST /api/media/complete — the file is up; record it.
 *
 * The browser names what it uploaded; the asset is then read back from
 * Cloudinary rather than believed. Its size becomes this church's storage
 * accounting and its url becomes a row people open, so a forged response must
 * not be able to inflate a quota or point a media row at somebody else's asset.
 * The folder check is the same one the meeting recordings use, for the same
 * reason: Cloudinary will happily describe any asset in the account.
 */
export async function POST(request: Request) {
  const { church, user } = await requireChurch();

  let body: {
    publicId?: string;
    resourceType?: string;
    kind?: string;
    title?: string;
    originalName?: string;
    mime?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Could not read that request." }, 400);
  }

  const kind: MediaKind = MEDIA_KINDS.includes(body.kind as MediaKind)
    ? (body.kind as MediaKind)
    : "file";
  if (!(await can(permForKind(kind))))
    return json({ ok: false, error: "You can't upload this." }, 403);

  const publicId = String(body.publicId ?? "");
  if (!publicId) return json({ ok: false, error: "No uploaded file was named." }, 400);

  if (!publicId.startsWith(`flockinsight/${church.id}/`))
    return json({ ok: false, error: "That file doesn't belong to this church." }, 403);

  const resourceType = (
    ["image", "video", "raw"].includes(String(body.resourceType))
      ? body.resourceType
      : "raw"
  ) as ResourceType;

  const asset = await fetchCloudinaryAsset(publicId, resourceType);
  if (!asset) {
    /*
     * Logged, not just returned. An upload that Cloudinary accepted and then
     * could not describe is the kind of thing that must leave a trace on the
     * server — the whole reason this class of bug survived so long is that
     * every failure happened somewhere nobody could see.
     */
    console.error(
      `[media/complete] Cloudinary would not confirm ${publicId} (${resourceType}) for church ${church.id}`,
    );
    return json(
      {
        ok: false,
        error:
          "The upload finished but we couldn't confirm it. Nothing was saved — please try again.",
      },
      502,
    );
  }

  const [row] = await db
    .insert(media)
    .values({
      churchId: church.id,
      kind,
      mime: String(body.mime ?? "") || `${asset.resourceType}/${asset.format ?? "bin"}`,
      size: asset.bytes,
      bytes: asset.bytes,
      provider: "cloudinary",
      publicId: asset.publicId,
      resourceType: asset.resourceType,
      url: asset.url,
      format: asset.format,
      width: asset.width,
      height: asset.height,
      durationSec: asset.durationSec,
      title: String(body.title ?? "").slice(0, 200) || String(body.originalName ?? "") || null,
      originalName: String(body.originalName ?? "").slice(0, 300) || null,
      uploadedBy: user.id,
    })
    .returning();

  await audit({
    churchId: church.id,
    action: "media.file.create",
    summary: `Uploaded "${row.title ?? row.originalName ?? "a file"}" to the media library`,
    targetType: "media",
    targetId: row.id,
    targetLabel: row.title ?? row.originalName ?? null,
    meta: { bytes: asset.bytes, kind, direct: true },
  });

  return json({
    ok: true,
    id: row.id,
    link: `/media/${row.id}`,
    url: row.url,
    bytes: row.bytes,
    kind: row.kind,
    mime: row.mime,
    title: row.title,
    width: row.width,
    height: row.height,
    durationSec: row.durationSec,
    createdAt: row.createdAt,
  });
}
