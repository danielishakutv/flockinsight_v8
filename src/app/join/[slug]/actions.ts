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
  sendSignupConfirmation,
  SIGNUP_OTP_PURPOSE,
  type SignupValues,
  type CleanSignup,
} from "@/lib/member-signup";
import { verifyOtp } from "@/lib/otp";
import { countryProfile } from "@/lib/country-profile";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { memberLimitStatus } from "@/lib/plan-limits";
import { notifyChurchManagers } from "@/lib/notifications";

/*
 * Ceilings on a public form that writes members and sends email and SMS.
 *
 * /join/<slug> is on by default and its slug is the church's handle, so it is
 * easy to find. Its only guard was a honeypot, which a script passes by
 * leaving the field empty — and every call inserted a member (plus up to
 * fifteen children), emailed "Welcome to <church>" with an attacker-chosen
 * name to any address, and with SMS confirmations on, charged a text to the
 * church's wallet.
 *
 * Two buckets, because the per-address one alone can be split across many
 * addresses: per IP (generous — a church foyer shares one wifi on a Sunday,
 * and a welcome-desk tablet registers a queue of people from one address)
 * and per church (a bound on the total, whoever is sending). In-memory and
 * per worker, as everywhere else that uses lib/rate-limit.
 *
 * The per-IP ceiling sits below the per-church one so one address can never
 * use up a church's whole hour, and either refusal tells the managers: a
 * kiosk being turned away looks, from the door, like registration is broken.
 */
const JOIN_PER_IP = { limit: 60, windowMs: 60 * 60_000 };
const JOIN_PER_CHURCH = { limit: 100, windowMs: 60 * 60_000 };
const VERIFY_PER_IP = { limit: 30, windowMs: 60 * 60_000 };
const TOO_MANY =
  "That is a lot of registrations from one place in a short time. Please try again shortly, or ask a member of the church team to add you.";

/**
 * Tell the church's managers, at most once an hour, that their link is being
 * turned away — flooding and a full plan both look, from the door, like
 * "registration is broken", and only they can act on either.
 */
async function tellManagersOnce(
  churchId: string,
  key: string,
  title: string,
  body: string,
  linkUrl: string,
): Promise<void> {
  if (!rateLimit(`join-notice:${key}:${churchId}`, 1, 60 * 60_000).ok) return;
  try {
    await notifyChurchManagers({ churchId, title, body, linkUrl });
  } catch (e) {
    // The refusal stands either way; a lost notice is logged, not thrown.
    console.error("[join] manager notice failed", e);
  }
}

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

  const ip = await clientIp();
  if (!rateLimit(`join:${ip}`, JOIN_PER_IP.limit, JOIN_PER_IP.windowMs).ok) {
    // The same one lookup an accepted request makes, so a refused flood costs
    // no more than an allowed one; tellManagersOnce sends at most hourly.
    const refusedAt = await getSignupBySlug(input.slug);
    if (refusedAt?.signup.enabled) {
      await tellManagersOnce(
        refusedAt.church.id,
        "per-ip",
        "Sign-ups from one place are being turned away",
        `More than ${JOIN_PER_IP.limit} sign-ups came from a single connection in the last hour, so further ones from it are being refused for now. If that is your welcome desk or the church wifi, people can still register from their own phone data, or a member of the team can add them.`,
        "/settings/signup",
      );
    }
    return { ok: false, error: TOO_MANY };
  }

  const data = await getSignupBySlug(input.slug);
  if (!data || !data.signup.enabled)
    return { ok: false, error: "This sign-up link isn't active right now." };

  if (
    !rateLimit(
      `join-church:${data.church.id}`,
      JOIN_PER_CHURCH.limit,
      JOIN_PER_CHURCH.windowMs,
    ).ok
  ) {
    await tellManagersOnce(
      data.church.id,
      "flood",
      "Your sign-up link is being turned away",
      `More than ${JOIN_PER_CHURCH.limit} sign-ups arrived through your self-registration link in the last hour, so further ones are being refused for now. If this is not your congregation, switch the link off or change it in Settings → Sign-up.`,
      "/settings/signup",
    );
    return { ok: false, error: TOO_MANY };
  }

  // Local numbers are read in the CHURCH's dial code, not Nigeria's.
  const cleaned = cleanSignupValues(
    input.values,
    data.signup,
    countryProfile(data.church.country).dial,
  );
  if (!cleaned.ok) return { ok: false, error: cleaned.error };
  const value = cleaned.value;

  const existing = await findExistingMember(
    data.church.id,
    value.emailNorm,
    value.phoneNorm,
  );

  if (!existing) {
    /*
     * The plan's member limit, which every other way of adding a member
     * enforces and this public one did not — so a Starter church could be
     * filled far past it by anyone with the link. Updating somebody already on
     * the register (the OTP branch below) adds nobody and is not limited.
     *
     * The person at the door cannot upgrade a plan, so they are told to ask
     * the church; the managers are told why, because to them it otherwise
     * looks like the link quietly stopped working.
     */
    const cap = await memberLimitStatus(data.church.id);
    if (cap.atLimit) {
      await tellManagersOnce(
        data.church.id,
        "member-limit",
        "Someone couldn't register: you're at your member limit",
        `Your plan covers ${cap.limit} members and you have ${cap.used}, so new sign-ups through your self-registration link are being turned away. Upgrade to accept them.`,
        "/settings/billing",
      );
      return {
        ok: false,
        error:
          "Registration is full right now. Please speak to a member of the church team, who can add you.",
      };
    }

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
    await sendSignupConfirmation({
      signup: data.signup,
      churchId: data.church.id,
      churchName: data.church.name,
      firstName: value.firstName,
      email: value.email,
      phone: value.phone,
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
  // Each guess is also bounded per code (lib/otp.ts); this bounds how many
  // codes one address can work through.
  const ip = await clientIp();
  if (!rateLimit(`join-verify:${ip}`, VERIFY_PER_IP.limit, VERIFY_PER_IP.windowMs).ok)
    return { ok: false, error: "Too many attempts. Please wait a while and try again." };

  const data = await getSignupBySlug(input.slug);
  if (!data) return { ok: false, error: "This sign-up link isn't active right now." };

  const res = await verifyOtp(input.otpId, input.code, {
    expectedPurpose: SIGNUP_OTP_PURPOSE,
  });
  if (!res.ok) return { ok: false, error: res.error };
  if (res.churchId !== data.church.id || !res.memberId || !res.payload)
    return { ok: false, error: "This verification is no longer valid. Please start again." };

  // Belt-and-braces: the code was issued for this purpose only — checked by
  // verifyOtp's expectedPurpose, and for this church just above.
  const value = res.payload as unknown as CleanSignup;
  const contact = await applyVerifiedUpdate(data.church.id, res.memberId, value);
  await notifySignupManagers({
    signup: data.signup,
    churchId: data.church.id,
    churchName: data.church.name,
    memberId: res.memberId,
    personName: [value.firstName, value.lastName].filter(Boolean).join(" "),
    isNew: false,
  });
  if (contact) {
    await sendSignupConfirmation({
      signup: data.signup,
      churchId: data.church.id,
      churchName: data.church.name,
      firstName: contact.firstName,
      email: contact.email,
      phone: contact.phone,
      isUpdate: true,
    });
  }
  revalidatePath("/members");
  revalidatePath("/dashboard");

  return { ok: true, message: data.signup.successMessage };
}
