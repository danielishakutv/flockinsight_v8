"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { memberSignup } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { ensureSignup, regenerateSignupSlug } from "@/lib/member-signup";

export type ActionResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  enabled: z.boolean(),
  title: z.string().trim().min(1).max(120),
  intro: z.string().trim().min(1).max(1000),
  successMessage: z.string().trim().min(1).max(500),
  newMemberStatus: z.enum(["active", "visitor", "new_convert"]),
  collectBirthday: z.boolean(),
  collectAddress: z.boolean(),
  collectAnniversary: z.boolean(),
  allowGroupSelect: z.boolean(),
  notifyInApp: z.boolean(),
  notifyEmail: z.boolean(),
  confirmEmail: z.boolean(),
  confirmSms: z.boolean(),
  confirmSubject: z.string().trim().min(1, "Add a subject").max(160),
  confirmMessage: z
    .string()
    .trim()
    .min(1, "Add a confirmation message")
    .max(500),
});

export type SignupSettingsInput = z.input<typeof schema>;

export async function saveSignupSettings(
  input: SignupSettingsInput,
): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  // Make sure a row (with a slug) exists first.
  await ensureSignup({ id: church.id, name: church.name, handle: church.handle });
  await db
    .update(memberSignup)
    .set(parsed.data)
    .where(eq(memberSignup.churchId, church.id));

  revalidatePath("/settings/signup");
  revalidatePath("/members");
  return { ok: true };
}

export async function regenerateSlug(): Promise<
  { ok: true; slug: string } | { ok: false; error: string }
> {
  const { church } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  await ensureSignup({ id: church.id, name: church.name, handle: church.handle });
  const slug = await regenerateSignupSlug(church.id, church.handle || church.name);
  revalidatePath("/settings/signup");
  return { ok: true, slug };
}
