"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, member, memberSignup } from "@/db/schema";
import {
  applyVerifiedUpdate,
  cleanSignupValues,
  ensureSignup,
  notifySignupManagers,
  sendSignupConfirmation,
  sendSignupOtp,
  type CleanSignup,
  type SignupValues,
} from "@/lib/member-signup";
import { consumeMemberUpdateToken } from "@/lib/member-update";
import { verifyOtp } from "@/lib/otp";

export type UpdateResult =
  | { ok: true; done: true; message: string }
  | {
      ok: true;
      needsOtp: true;
      otpId: string;
      channel: "email" | "sms";
      masked: string;
    }
  | { ok: false; error: string };

const DEAD_LINK =
  "This update link is no longer valid — it may already have been used. Please ask your church for a new one.";

type Loaded = {
  member: { id: string; email: string | null; phone: string | null };
  church: { id: string; name: string; handle: string | null };
  signup: typeof memberSignup.$inferSelect;
};

/** Resolve a still-valid token to its member, church and sign-up config. */
async function loadByToken(token: string): Promise<Loaded | null> {
  const [m] = await db
    .select({
      id: member.id,
      churchId: member.churchId,
      email: member.email,
      phone: member.phone,
    })
    .from(member)
    .where(eq(member.updateToken, token))
    .limit(1);
  if (!m) return null;

  const [c] = await db
    .select({ id: church.id, name: church.name, handle: church.handle })
    .from(church)
    .where(eq(church.id, m.churchId))
    .limit(1);
  if (!c) return null;

  const signup = await ensureSignup({ id: c.id, name: c.name, handle: c.handle });
  return {
    member: { id: m.id, email: m.email, phone: m.phone },
    church: c,
    signup,
  };
}

/** Apply the update, consume the token (one-time), notify + acknowledge. */
async function applyAndFinish(
  loaded: Loaded,
  value: CleanSignup,
): Promise<string> {
  const { church: c, member: m, signup } = loaded;
  const contact = await applyVerifiedUpdate(c.id, m.id, value);
  // One-time: the link stops working until a manager re-issues it.
  await consumeMemberUpdateToken(c.id, m.id);
  await notifySignupManagers({
    signup,
    churchId: c.id,
    churchName: c.name,
    memberId: m.id,
    personName: [value.firstName, value.lastName].filter(Boolean).join(" "),
    isNew: false,
  });
  if (contact) {
    await sendSignupConfirmation({
      signup,
      churchId: c.id,
      churchName: c.name,
      firstName: contact.firstName,
      email: contact.email,
      phone: contact.phone,
      isUpdate: true,
    });
  }
  revalidatePath("/members");
  revalidatePath(`/members/${m.id}`);
  return signup.successMessage;
}

/**
 * A member submits their pre-filled self-update. The link is single-use. When
 * the church requires verification, we send a one-time code to the member's
 * contact on file and defer the change to {@link verifyMemberUpdate}.
 */
export async function submitMemberUpdate(input: {
  token: string;
  values: SignupValues;
}): Promise<UpdateResult> {
  const token = (input.token || "").trim();
  if (!token) return { ok: false, error: DEAD_LINK };
  const loaded = await loadByToken(token);
  if (!loaded) return { ok: false, error: DEAD_LINK };

  const cleaned = cleanSignupValues(input.values, loaded.signup);
  if (!cleaned.ok) return { ok: false, error: cleaned.error };

  if (loaded.signup.requireUpdateOtp) {
    const otp = await sendSignupOtp({
      churchId: loaded.church.id,
      churchName: loaded.church.name,
      memberId: loaded.member.id,
      memberEmail: loaded.member.email,
      memberPhone: loaded.member.phone,
      payload: cleaned.value as unknown as Record<string, unknown>,
    });
    if (!otp.ok) return { ok: false, error: otp.error };
    return {
      ok: true,
      needsOtp: true,
      otpId: otp.otpId,
      channel: otp.channel,
      masked: otp.masked,
    };
  }

  const message = await applyAndFinish(loaded, cleaned.value);
  return { ok: true, done: true, message };
}

/** Confirm the one-time code and apply a verification-gated self-update. */
export async function verifyMemberUpdate(input: {
  token: string;
  otpId: string;
  code: string;
}): Promise<UpdateResult> {
  const token = (input.token || "").trim();
  if (!token) return { ok: false, error: DEAD_LINK };
  const loaded = await loadByToken(token);
  if (!loaded) return { ok: false, error: DEAD_LINK };

  const res = await verifyOtp(input.otpId, input.code);
  if (!res.ok) return { ok: false, error: res.error };
  if (res.churchId !== loaded.church.id || res.memberId !== loaded.member.id || !res.payload)
    return {
      ok: false,
      error: "This verification is no longer valid. Please start again.",
    };

  const message = await applyAndFinish(
    loaded,
    res.payload as unknown as CleanSignup,
  );
  return { ok: true, done: true, message };
}
