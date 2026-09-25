"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { deleteMedia } from "@/lib/media";
import { audit } from "@/lib/audit";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Delete one file the church owns (removes the Cloudinary asset too). */
export async function deleteMediaAction(id: string): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("media.manage")))
    return { ok: false, error: "You don't have permission to do that." };

  // Read it before it goes: the log has to be able to name the file that was
  // deleted, and after the delete there is nothing left to name it with.
  const [file] = await db
    .select({
      title: media.title,
      originalName: media.originalName,
      bytes: media.bytes,
      mime: media.mime,
      kind: media.kind,
    })
    .from(media)
    .where(and(eq(media.id, id), eq(media.churchId, church.id)))
    .limit(1);

  const ok = await deleteMedia(id, church.id);
  if (!ok) return { ok: false, error: "File not found." };

  const name = file?.title || file?.originalName || "a file";
  await audit({
    churchId: church.id,
    action: "media.file.delete",
    summary: `Deleted ${name} from the media library`,
    targetType: "media",
    targetId: id,
    targetLabel: name,
    meta: { bytes: file?.bytes, mime: file?.mime, kind: file?.kind },
    severity: "critical",
  });

  revalidatePath("/media");
  revalidatePath("/settings/storage");
  return { ok: true };
}

/** Rename a file (its display title) — handy for sermons. */
export async function renameMediaAction(
  id: string,
  title: string,
): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("media.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  const clean = title.trim().slice(0, 200);
  const res = await db
    .update(media)
    .set({ title: clean || null })
    .where(and(eq(media.id, id), eq(media.churchId, church.id)))
    .returning({ id: media.id });
  if (!res.length) return { ok: false, error: "File not found." };

  await audit({
    churchId: church.id,
    action: "media.file.update",
    summary: `Renamed a file in the media library to "${clean || "(no title)"}"`,
    targetType: "media",
    targetId: id,
    targetLabel: clean || null,
  });

  revalidatePath("/media");
  return { ok: true };
}
