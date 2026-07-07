"use server";

import { revalidatePath } from "next/cache";
import {
  getSignupBySlug,
  cleanSignupValues,
  findExistingMember,
  createMemberFromSignup,
  applyVerifiedUpdate,
  sendSignupOtp,
  notifySignupManagers,
  type SignupValues,
  type CleanSignup,
} from "@/lib/member-signup";
import { verifyOtp } from "@/lib/otp";

export type SubmitSignupResult =
  | { ok: true; done: true; message: string }
  | { ok: true; needsOtp: true; otpId: string; channel: "email" | "sms"; masked: string }
  | { ok: false; error: string };

/**
 * Public: a person submits the self-registration form. If they match an
 * existing member we require an OTP before changing anything; otherwise we
 * create a new member immediately.
 */
export async function submitSelfRegistration(input: {
  slug: string;
  values: SignupValues;
  hp?: string; // honeypot
}): Promise<SubmitSignupResult> {
  // Honeypot — pretend success for bots.
  if (input.hp && input.hp.trim() !== "")
    return { ok: true, done: true, message: "Thank you! Your details have been saved." };

  const data = await getSignupBySlug(input.slug);
  if (!data || !data.signup.enabled)
    return { ok: false, error: "This sign-up link isn't active right now." };

  const cleaned = cleanSignupValues(input.values, data.signup);
  if (!cleaned.ok) return { ok: false, error: cleaned.error };
  const value = cleaned.value;

  const existing = await findExistingMember(
    data.church.id,
    value.emailNorm,
    value.phoneNorm,
  );

  if (!existing) {
    // Brand new person → create straight away.
    const memberId = await createMemberFromSignup(data.church.id, value, data.signup);
    await notifySignupManagers({
      signup: data.signup,
      churchId: data.church.id,
      churchName: data.church.name,
      memberId,
      personName: [value.firstName, value.lastName].filter(Boolean).join(" "),
      isNew: true,
    });
    revalidatePath("/members");
    revalidatePath("/dashboard");
    return { ok: true, done: true, message: data.signup.successMessage };
  }

  // Matched an existing record → require ownership verification first.
  const otp = await sendSignupOtp({
    churchId: data.church.id,
    churchName: data.church.name,
    memberId: existing.id,
    memberEmail: existing.email,
    memberPhone: existing.phone,
    payload: value as unknown as Record<string, unknown>,
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

export type VerifySignupResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Public: confirm the OTP sent to an existing member and apply their update
 * (and promote a visitor to a full member).
 */
export async function verifySelfRegistration(input: {
  slug: string;
  otpId: string;
  code: string;
}): Promise<VerifySignupResult> {
  const data = await getSignupBySlug(input.slug);
  if (!data) return { ok: false, error: "This sign-up link isn't active right now." };

  const res = await verifyOtp(input.otpId, input.code);
  if (!res.ok) return { ok: false, error: res.error };
  if (res.churchId !== data.church.id || !res.memberId || !res.payload)
    return { ok: false, error: "This verification is no longer valid. Please start again." };

  // Belt-and-braces: the code was issued for this purpose only.
  const value = res.payload as unknown as CleanSignup;
  await applyVerifiedUpdate(data.church.id, res.memberId, value);
  await notifySignupManagers({
    signup: data.signup,
    churchId: data.church.id,
    churchName: data.church.name,
    memberId: res.memberId,
    personName: [value.firstName, value.lastName].filter(Boolean).join(" "),
    isNew: false,
  });
  revalidatePath("/members");
  revalidatePath("/dashboard");

  return { ok: true, message: data.signup.successMessage };
}
