"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationRead, pushSubscription } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { listNotifications } from "@/lib/notifications";

export type ActionResult = { ok: true } | { ok: false; error: string };

function ctx() {
  return requireChurch();
}

export async function markNotificationRead(
  notificationId: string,
): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(notificationId).success)
    return { ok: false, error: "Invalid id" };
  const { user } = await ctx();
  await db
    .insert(notificationRead)
    .values({ notificationId, userId: user.id })
    .onConflictDoNothing();
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const { church, user } = await ctx();
  const items = await listNotifications({
    churchId: church.id,
    plan: church.plan,
    country: church.country,
    userId: user.id,
  });
  const ids = items.filter((i) => !i.read).map((i) => i.id);
  if (ids.length > 0) {
    await db
      .insert(notificationRead)
      .values(ids.map((id) => ({ notificationId: id, userId: user.id })))
      .onConflictDoNothing();
  }
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
  return { ok: true };
}

const subSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export async function savePushSubscription(
  sub: z.input<typeof subSchema>,
): Promise<ActionResult> {
  const parsed = subSchema.safeParse(sub);
  if (!parsed.success) return { ok: false, error: "Invalid subscription" };
  const { user } = await ctx();
  await db
    .insert(pushSubscription)
    .values({
      userId: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscription.endpoint,
      set: {
        userId: user.id,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
      },
    });
  return { ok: true };
}

export async function removePushSubscription(
  endpoint: string,
): Promise<ActionResult> {
  if (!endpoint) return { ok: false, error: "Missing endpoint" };
  await ctx();
  // Endpoint is globally unique; clearing it stops pushes to that device.
  await db
    .delete(pushSubscription)
    .where(eq(pushSubscription.endpoint, endpoint));
  return { ok: true };
}
