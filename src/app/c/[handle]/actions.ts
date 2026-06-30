"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, subscriber } from "@/db/schema";

export type SubscribeResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  handle: z.string().trim().min(1),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email.").max(160),
});

/** Public newsletter sign-up from a church's public page. */
export async function subscribeNewsletter(input: {
  handle: string;
  name?: string;
  email: string;
}): Promise<SubscribeResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid." };
  const d = parsed.data;

  const [c] = await db
    .select({ id: church.id })
    .from(church)
    .where(and(eq(church.handle, d.handle), eq(church.publicEnabled, true)))
    .limit(1);
  if (!c) return { ok: false, error: "Church not found." };

  await db
    .insert(subscriber)
    .values({
      churchId: c.id,
      name: d.name?.trim().slice(0, 120) || null,
      email: d.email,
      source: "public",
    })
    .onConflictDoUpdate({
      target: [subscriber.churchId, subscriber.email],
      set: { status: "active", ...(d.name ? { name: d.name.trim().slice(0, 120) } : {}) },
    });

  return { ok: true };
}
