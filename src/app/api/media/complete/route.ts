import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { churchForApi, refusalResponse } from "@/lib/api-church";
import {
  destroyFromCloudinary,
  fetchCloudinaryAsset,
  type CloudinaryAsset,
  type ResourceType,
} from "@/lib/cloudinary";
import {
  canUploadKind,
  refuseUploadKind,
  rememberOrphan,
  MEDIA_KINDS,
  type MediaKind,
} from "@/lib/media";
import { LIBRARY_FORBIDDEN } from "@/lib/media-upload-rules";
import { closeUploadTicket, lockChurchMediaQuota } from "@/lib/media-upload-tickets";
import { getStorageInfo } from "@/lib/storage";
import { formatBytes } from "@/lib/storage-bytes";
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
/**
 * Take back an asset this route will not file, so it neither sits in the
 * church's folder uncounted nor bills the platform for ever. If Cloudinary
 * will not delete it now, it is written down for the storage cron.
 */
async function refuse(
  churchId: string,
  asset: CloudinaryAsset,
  body: Record<string, unknown>,
  status: number,
): Promise<Response> {
  const gone = await destroyFromCloudinary(asset.publicId, asset.resourceType);
  if (!gone)
    await rememberOrphan(churchId, asset.publicId, asset.resourceType, "refused at /media/complete");
  return json({ ok: false, ...body }, status);
}

export async function POST(request: Request) {
  const who = await churchForApi();
  if (!who.ok) return refusalResponse(who);
  const { church, user } = who;

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
  if (!(await canUploadKind(kind)))
    return json({ ok: false, code: "forbidden", error: LIBRARY_FORBIDDEN }, 403);

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

  /*
   * Everything /sign checked, checked again against what Cloudinary actually
   * holds. The size at /sign was the browser's word; this is the real one, and
   * an asset that does not fit is taken back rather than filed.
   */
  const gate = await refuseUploadKind(kind);
  if (gate) return refuse(church.id, asset, gate, 403);

  /*
   * One row per asset, however many times this is called, and one quota
   * decision at a time per church. Serialised on the CHURCH for the length of
   * a transaction: two completes racing for the same file cannot both see "no
   * row yet" and both insert, and two completes for DIFFERENT files cannot
   * both see the same last 1 MB free and both pass (READ COMMITTED would let
   * them). The same lock /sign takes, so a ticket is never issued against
   * room a complete is in the middle of using.
   */
  type Outcome =
    | { kind: "existing"; row: typeof media.$inferSelect }
    | { kind: "full"; free: number }
    | { kind: "reaped" }
    | { kind: "new"; row: typeof media.$inferSelect };
  const outcome: Outcome = await db.transaction(async (tx) => {
    await lockChurchMediaQuota(tx, church.id);
    const [existing] = await tx
      .select()
      .from(media)
      .where(and(eq(media.churchId, church.id), eq(media.publicId, asset.publicId)))
      .limit(1);
    if (existing) return { kind: "existing", row: existing };

    /*
     * Close the ticket this upload was given. A ticket the storage cron has
     * already reaped means the asset is being destroyed: filing it would make
     * a row that points at nothing. Closed even when the quota below turns
     * the file away: `refuse` then destroys the asset (or records it as an
     * orphan), so nothing is left for the ticket sweep to do.
     */
    const ticket = await closeUploadTicket(tx, church.id, asset.publicId);
    if (ticket === "reaped") return { kind: "reaped" };

    const info = await getStorageInfo(church.id, church.storageExtraBytes);
    if (info.used + asset.bytes > info.limit) return { kind: "full", free: info.free };

    const [inserted] = await tx
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
    return { kind: "new", row: inserted };
  });

  if (outcome.kind === "reaped")
    return json(
      {
        ok: false,
        code: "expired",
        error: "That upload took too long to finish and was cleared away. Nothing was saved — please upload it again.",
      },
      410,
    );
  if (outcome.kind === "full")
    return refuse(
      church.id,
      asset,
      {
        error: `Not enough storage — this file is ${formatBytes(asset.bytes)} and you have ${formatBytes(outcome.free)} free. Nothing was saved. Free up space or upgrade your storage.`,
      },
      413,
    );
  const row = outcome.row;

  // A repeat of a complete that already filed this asset is not a new upload.
  if (outcome.kind === "new") {
    await audit({
      churchId: church.id,
      action: "media.file.create",
      summary: `Uploaded "${row.title ?? row.originalName ?? "a file"}" to the media library`,
      targetType: "media",
      targetId: row.id,
      targetLabel: row.title ?? row.originalName ?? null,
      meta: { bytes: asset.bytes, kind, direct: true },
    });
  }

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
