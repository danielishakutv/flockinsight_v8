"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function setChurchStatus(
  id: string,
  status: "active" | "suspended",
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().min(1).safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  if (status !== "active" && status !== "suspended")
    return { ok: false, error: "Invalid status" };

  await db.update(church).set({ status }).where(eq(church.id, id));
  revalidatePath("/superadmin/churches");
  revalidatePath("/superadmin");
  return { ok: true };
}
