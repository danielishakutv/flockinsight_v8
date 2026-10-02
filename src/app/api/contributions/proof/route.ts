import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, contribution } from "@/db/schema";
import { getSession } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { canManageContribution } from "@/lib/contributions";
import { isCloudinaryConfigured } from "@/lib/cloudinary";
import { storeMedia } from "@/lib/media";
import { getStorageInfo } from "@/lib/storage";
import { formatBytes } from "@/lib/storage-bytes";
import { proofRejection } from "@/lib/contributions-shared";
import { rateLimit } from "@/lib/meeting-api";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/contributions/proof — attach a receipt to a contribution.
 *
 * One route for two very different callers, which is why it reads the way it
 * does. A manager posts `potId` and is authorised by permission. Somebody who
 * was sent a WhatsApp link posts `slug` and has no account at all — they are
 * recording their own payment, and the receipt is the whole reason anyone will
 * believe them. Refusing anonymous uploads would mean the self-report form
 * could never carry proof, which is most of its value.
 *
 * So the public path is narrowed instead of closed:
 *
 *   - the pot must exist, be open, and have self-reporting switched on;
 *   - the file must be an image or a PDF, within the ceilings in
 *     contributions-shared.ts;
 *   - the church must have the storage for it;
 *   - and an IP gets a handful of uploads an hour, because an open upload
 *     endpoint with no limit is somebody else's free image host.
 *
 * What an attacker gets for all that is the ability to put one small optimised
 * image into one church's storage — the same thing they could do by walking in
 * and handing over a teller. The file is never rendered as HTML, never served
 * from our origin, and is not linked to anything until the self-report form
 * that follows actually succeeds.
 */

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: Request) {
  if (!isCloudinaryConfigured())
    return json(
      { ok: false, error: "Receipt uploads aren't set up on this site yet." },
      503,
    );

  let file: File | null = null;
  let potId = "";
  let slug = "";
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    const p = form.get("potId");
    if (typeof p === "string") potId = p.trim();
    const s = form.get("slug");
    if (typeof s === "string") slug = s.trim();
  } catch {
    return json({ ok: false, error: "Could not read the upload." }, 400);
  }

  if (!file) return json({ ok: false, error: "No file was attached." }, 400);

  const rejection = proofRejection({ type: file.type, size: file.size });
  if (rejection) return json({ ok: false, error: rejection }, 400);

  // `cf-connecting-ip` is the only header a client cannot forge on this
  // deployment — see the note in lib/auth.ts about x-forwarded-for.
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown";

  let churchId: string | null = null;

  if (potId) {
    // ----- A manager, inside the app -----
    const session = await getSession();
    if (!session?.user) return json({ ok: false, error: "Please sign in." }, 401);
    const activeChurchId = session.session.activeOrganizationId;
    if (!activeChurchId)
      return json({ ok: false, error: "No church selected." }, 403);

    const access = await getAccess();
    const allowed = await canManageContribution({
      churchId: activeChurchId,
      userId: session.user.id,
      potId,
      hasModulePermission: access.isOwner || access.perms.has("contributions.manage"),
    });
    if (!allowed)
      return json({ ok: false, error: "You can't add receipts to this one." }, 403);
    churchId = activeChurchId;
  } else if (slug) {
    // ----- Somebody with the link, recording their own payment -----
    const gate = rateLimit(`contrib-proof:${ip}`, 10, 60 * 60_000);
    if (!gate.ok)
      return json(
        {
          ok: false,
          error: "That's a lot of uploads. Please try again in a little while.",
        },
        429,
      );

    const [pot] = await db
      .select({
        churchId: contribution.churchId,
        status: contribution.status,
        allowSelfReport: contribution.allowSelfReport,
        visibility: contribution.visibility,
      })
      .from(contribution)
      .where(eq(contribution.slug, slug))
      .limit(1);
    if (!pot) return json({ ok: false, error: "That link isn't valid." }, 404);
    if (pot.visibility === "private" || pot.status !== "open" || !pot.allowSelfReport)
      return json(
        { ok: false, error: "This collection isn't taking entries right now." },
        403,
      );
    churchId = pot.churchId;
  } else {
    return json({ ok: false, error: "Nothing to attach this to." }, 400);
  }

  // The church must exist and not be suspended — a suspended church keeps its
  // files and gains no new ones.
  const [c] = await db
    .select({ id: church.id, status: church.status, extra: church.storageExtraBytes })
    .from(church)
    .where(and(eq(church.id, churchId)))
    .limit(1);
  if (!c) return json({ ok: false, error: "That link isn't valid." }, 404);
  if (c.status === "suspended")
    return json({ ok: false, error: "This church's account is paused." }, 403);

  // Checked against the INCOMING size. The stored receipt is far smaller once
  // Cloudinary has re-encoded it, so this errs on the side of refusing.
  const info = await getStorageInfo(c.id, c.extra);
  if (info.used + file.size > info.limit) {
    return json(
      {
        ok: false,
        error: potId
          ? `Not enough storage — ${formatBytes(info.used)} of ${formatBytes(info.limit)} used. Free up space or upgrade.`
          : "The church's file storage is full, so the receipt can't be saved. You can still record the payment without it.",
      },
      413,
    );
  }

  try {
    const row = await storeMedia({
      churchId: c.id,
      buffer: Buffer.from(await file.arrayBuffer()),
      mime: file.type,
      kind: "receipt",
      originalName: file.name,
      title: "Contribution receipt",
    });
    return json({
      ok: true,
      mediaId: row.id,
      bytes: row.bytes,
      mime: row.mime,
      url: row.url,
    });
  } catch (e) {
    console.error("[contributions/proof] upload failed", e);
    return json(
      {
        ok: false,
        error:
          "The receipt couldn't be saved. You can record the payment without it and attach one later.",
      },
      500,
    );
  }
}
