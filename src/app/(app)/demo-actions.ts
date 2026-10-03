"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireChurch } from "@/lib/session";
import {
  abandonDemoVisit,
  confirmDemoCode,
  sendDemoCode,
  startDemoVisit,
} from "@/lib/demo";

export type DemoResult = { ok: true } | { ok: false; error: string };
export type DemoCodeResult = { ok: true; masked: string } | { ok: false; error: string };

/*
 * These run for somebody signed in as the shared demo account, which is as
 * close to anonymous as this app gets. So each one re-reads the church from
 * the session and refuses unless that church is actually the demo — otherwise
 * a real church's admin could call them and plant a demo cookie on their own
 * workspace.
 */
async function demoChurch() {
  const { church } = await requireChurch();
  if (!church.isDemo) return null;
  return church;
}

const startSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().min(3).max(254),
  phone: z.string().trim().min(5).max(40),
});

/** Say who you are, and the demo opens for fifteen minutes. */
export async function startDemo(
  input: z.input<typeof startSchema>,
): Promise<DemoResult> {
  const c = await demoChurch();
  if (!c) return { ok: false, error: "This isn't the demo church." };

  const parsed = startSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Fill in both fields.",
    };

  const res = await startDemoVisit({
    churchId: c.id,
    name: parsed.data.name ?? null,
    email: parsed.data.email,
    phone: parsed.data.phone,
  });
  if (!res.ok) return res;

  // The whole shell changes: the gate goes, the countdown appears.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Ask for the code that lifts the fifteen-minute limit. */
export async function requestDemoCode(): Promise<DemoCodeResult> {
  const c = await demoChurch();
  if (!c) return { ok: false, error: "This isn't the demo church." };
  return sendDemoCode(c.id);
}

/** Enter it. */
export async function verifyDemoCode(code: string): Promise<DemoResult> {
  const c = await demoChurch();
  if (!c) return { ok: false, error: "This isn't the demo church." };
  const res = await confirmDemoCode(c.id, String(code || ""));
  if (!res.ok) return res;
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Start over with a different address. */
export async function restartDemo(): Promise<DemoResult> {
  const c = await demoChurch();
  if (!c) return { ok: false, error: "This isn't the demo church." };
  await abandonDemoVisit();
  revalidatePath("/", "layout");
  return { ok: true };
}
