"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notification, notificationTarget } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { resolveAudienceUserIds } from "@/lib/notifications";
import { sendPushToUsers } from "@/lib/push";

export type CreateResult =
  | { ok: true; pushSent: number }
  | { ok: false; error: string };

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const schema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
  body: z.string().trim().min(1, "Message is required").max(2000),
  category: z.enum(["system", "general"]),
  audience: z.enum(["all", "plan", "country", "churches"]),
  targetPlan: z.preprocess(
    emptyToNull,
    z.enum(["starter", "growth", "pro", "enterprise"]).nullable(),
  ),
  targetCountry: z.preprocess(emptyToNull, z.string().trim().max(80).nullable()),
  churchIds: z.array(z.string()).default([]),
  linkUrl: z.preprocess(emptyToNull, z.string().trim().max(300).nullable()),
  sendPush: z.boolean().default(true),
});

export async function createNotification(
  input: z.input<typeof schema>,
): Promise<CreateResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  // Validate targeting completeness.
  if (d.audience === "plan" && !d.targetPlan)
    return { ok: false, error: "Choose a plan to target." };
  if (d.audience === "country" && !d.targetCountry)
    return { ok: false, error: "Choose a country to target." };
  if (d.audience === "churches" && d.churchIds.length === 0)
    return { ok: false, error: "Pick at least one church." };

  const admin = await requireSuperAdmin();

  const [row] = await db
    .insert(notification)
    .values({
      title: d.title,
      body: d.body,
      category: d.category,
      audience: d.audience,
      targetPlan: d.audience === "plan" ? d.targetPlan : null,
      targetCountry: d.audience === "country" ? d.targetCountry : null,
      linkUrl: d.linkUrl,
      createdBy: admin.id,
    })
    .returning({ id: notification.id });

  if (d.audience === "churches" && d.churchIds.length > 0) {
    await db
      .insert(notificationTarget)
      .values(d.churchIds.map((churchId) => ({ notificationId: row.id, churchId })))
      .onConflictDoNothing();
  }

  let pushSent = 0;
  if (d.sendPush) {
    const userIds = await resolveAudienceUserIds({
      audience: d.audience,
      targetPlan: d.targetPlan,
      targetCountry: d.targetCountry,
      churchIds: d.churchIds,
    });
    pushSent = await sendPushToUsers(userIds, {
      title: d.title,
      body: d.body,
      url: d.linkUrl || "/notifications",
      tag: row.id,
    });
    if (pushSent > 0) {
      await db
        .update(notification)
        .set({ pushSent })
        .where(eq(notification.id, row.id));
    }
  }

  revalidatePath("/superadmin/notifications");
  return { ok: true, pushSent };
}
