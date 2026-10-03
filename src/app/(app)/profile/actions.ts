"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { getActiveChurchId, requireUser } from "@/lib/session";
import { audit, auditSystem } from "@/lib/audit";
import { setUserPassword, verifyUserPassword } from "@/lib/admin-users";
import {
  confirmAccountChange,
  startEmailChange,
  startPhoneChange,
} from "@/lib/account-verification";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type CodeResult =
  | { ok: true; otpId: string; masked: string }
  | { ok: false; error: string };

/*
 * Everything here answers to the signed-in person and to nobody else. There is
 * deliberately no `userId` parameter anywhere in this file: an action that
 * takes one is an action that can be pointed at somebody else's account, and
 * no amount of checking afterwards is as safe as never accepting it.
 *
 * Audit rows are written against the person's active church when they have
 * one, so a church's activity log shows "changed their own email" the way it
 * shows everything else. A platform operator with no church still gets a
 * platform-scoped row — the change is no less worth recording.
 */

const profileSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  image: z.string().trim().max(1000).nullable(),
});

/** Name and photo. Neither needs proving, so both save straight away. */
export async function updateMyProfile(
  input: z.input<typeof profileSchema>,
): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const { user: me } = await requireUser();
  const [before] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, me.id))
    .limit(1);

  await db
    .update(user)
    .set({
      name: parsed.data.name,
      image: parsed.data.image || null,
      updatedAt: new Date(),
    })
    .where(eq(user.id, me.id));

  await record({
    action: "auth.profile.update",
    summary:
      before && before.name !== parsed.data.name
        ? `Changed their own name from "${before.name}" to "${parsed.data.name}"`
        : "Updated their own profile",
    targetId: me.id,
  });

  // The name and photo are in the shell on every page.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Send a code to a NEW email address. Nothing is saved until it comes back. */
export async function sendEmailChangeCode(email: string): Promise<CodeResult> {
  const { user: me } = await requireUser();
  const res = await startEmailChange({
    userId: me.id,
    userName: me.name,
    currentEmail: me.email,
    email,
  });
  if (!res.ok) return res;
  return { ok: true, otpId: res.otpId, masked: res.masked };
}

/** Send a code by SMS to a NEW phone number. */
export async function sendPhoneChangeCode(phone: string): Promise<CodeResult> {
  const { user: me } = await requireUser();
  const res = await startPhoneChange({
    userId: me.id,
    userName: me.name,
    phone,
  });
  if (!res.ok) return res;
  return { ok: true, otpId: res.otpId, masked: res.masked };
}

/** Enter the code, and the change lands. */
export async function confirmContactChange(
  otpId: string,
  code: string,
): Promise<
  { ok: true; field: "email" | "phone" } | { ok: false; error: string }
> {
  const { user: me } = await requireUser();
  const res = await confirmAccountChange({
    userId: me.id,
    otpId: String(otpId || ""),
    code: String(code || ""),
  });
  if (!res.ok) return res;

  await record({
    action: res.field === "email" ? "auth.email.change" : "auth.phone.change",
    summary:
      res.field === "email"
        ? `Changed their own sign-in email to ${res.value}`
        : `Verified their own phone number ${res.value}`,
    targetId: me.id,
    // Moving a sign-in email is the single most useful line in this log when
    // an account turns out to have been taken over.
    severity: res.field === "email" ? "warning" : "info",
  });

  revalidatePath("/", "layout");
  return { ok: true, field: res.field };
}

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password."),
    next: z.string().min(8, "Your new password must be at least 8 characters."),
    confirm: z.string().min(1, "Repeat your new password."),
  })
  .refine((v) => v.next === v.confirm, {
    message: "The new passwords don't match.",
    path: ["confirm"],
  });

/**
 * Change your own password.
 *
 * The current one is required and checked. Without that, an unlocked phone on
 * a church desk is a permanent account takeover — the one case where asking
 * somebody to type something they already know is worth the friction.
 */
export async function changeMyPassword(
  input: z.input<typeof passwordSchema>,
): Promise<ActionResult> {
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const { user: me } = await requireUser();

  const ok = await verifyUserPassword(me.id, parsed.data.current);
  if (ok === null)
    return {
      ok: false,
      error: "This account signs in another way, so there's no password to change.",
    };
  if (!ok) return { ok: false, error: "That isn't your current password." };

  const written = await setUserPassword(me.id, parsed.data.next);
  if (!written)
    return { ok: false, error: "Your account has no password to change." };

  await db
    .update(user)
    // A password they chose themselves satisfies any forced change.
    .set({ mustChangePassword: false, updatedAt: new Date() })
    .where(eq(user.id, me.id));

  await record({
    action: "auth.password.change",
    summary: "Changed their own password",
    targetId: me.id,
    severity: "notice",
  });

  return { ok: true };
}

/** One audit row, church-scoped when there is a church to scope it to. */
async function record(opts: {
  action: string;
  summary: string;
  targetId: string;
  severity?: "info" | "notice" | "warning" | "critical";
}): Promise<void> {
  const churchId = await getActiveChurchId();
  const entry = {
    action: opts.action,
    summary: opts.summary,
    targetType: "user",
    targetId: opts.targetId,
    severity: opts.severity,
  };
  if (churchId) await audit({ churchId, ...entry });
  else await auditSystem(entry);
}
