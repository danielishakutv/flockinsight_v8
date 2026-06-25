"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function applySenderId(
  senderId: string,
  note: string,
): Promise<ActionResult> {
  const id = (senderId || "").trim();
  if (!/^[A-Za-z0-9 ]{3,11}$/.test(id))
    return {
      ok: false,
      error: "Sender ID must be 3–11 letters or numbers (no symbols).",
    };

  const { church: c } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };

  await db
    .update(church)
    .set({
      smsSenderId: id,
      smsSenderStatus: "pending",
      smsSenderNote: (note || "").trim().slice(0, 500) || null,
    })
    .where(eq(church.id, c.id));

  revalidatePath("/settings/sms");
  return { ok: true };
}
