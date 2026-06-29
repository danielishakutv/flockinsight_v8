"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { deleteMedia } from "@/lib/media";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Delete one file the church owns (removes the Cloudinary asset too). */
export async function deleteMediaAction(id: string): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("media.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  const ok = await deleteMedia(id, church.id);
  if (!ok) return { ok: false, error: "File not found." };
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
  revalidatePath("/media");
  return { ok: true };
}
