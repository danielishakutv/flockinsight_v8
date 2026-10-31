"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, staff } from "@/db/schema";
import { getSession } from "@/lib/session";
import {
  abandonDemoVisit,
  confirmDemoCode,
  sendDemoCode,
  startDemoVisit,
} from "@/lib/demo";
import { checkDemoContact } from "@/lib/demo-shared";

export type DemoResult = { ok: true } | { ok: false; error: string };
export type DemoCodeResult = { ok: true; masked: string } | { ok: false; error: string };

/*
 * These run for somebody signed in as the shared demo account, which is as
 * close to anonymous as this app gets. So each one re-reads the church from
 * the session and refuses unless that church is actually the demo, and they
 * genuinely sit in it — otherwise a real church's admin could call them and
 * plant a demo cookie on their own workspace.
 *
 * NOT requireChurch(). That is where the demo gate lives, so for a visitor
 * who has not yet given their details it redirects to /try — which is where
 * they already are. Calling it here made the signed-in form unable to ever
 * succeed: every submit was a redirect back to the same form.
 */
async function demoChurch() {
  const data = await getSession();
  const churchId = data?.session.activeOrganizationId;
  if (!data?.user || !churchId) return null;
  const [row] = await db
    .select({ id: church.id, isDemo: church.isDemo })
    .from(church)
    .innerJoin(staff, eq(staff.organizationId, church.id))
    .where(
      and(
        eq(church.id, churchId),
        eq(staff.userId, data.user.id),
        eq(staff.temp, false),
      ),
    )
    .limit(1);
  return row?.isDemo ? row : null;
}

const startSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().min(3).max(254),
  phone: z.string().trim().min(5).max(40),
  country: z.string().trim().length(2),
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
      error: parsed.error.issues[0]?.message ?? "Fill in your email and phone.",
    };
  // The same check the form ran: email and phone required, phone with its code.
  const contact = checkDemoContact(parsed.data);
  if (!contact.ok) return contact;

  const res = await startDemoVisit({
    churchId: c.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    country: contact.country,
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
