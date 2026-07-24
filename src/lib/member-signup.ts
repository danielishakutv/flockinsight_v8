import "server-only";
import { and, asc, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  communicationLog,
  group,
  groupMembership,
  member,
  memberSignup,
  type MemberSignup,
} from "@/db/schema";
import { normalizePhone, smsPages } from "@/lib/sms";
import { normalizeBirthday } from "@/lib/birthday";
import { slugify, randomSuffix } from "@/lib/slug";
import { siteUrl } from "@/lib/site";
import { notifyChurchManagers } from "@/lib/notifications";
import { sendEmail, emailLayout, isEmailConfigured } from "@/lib/mailer";
import { sendChurchSms } from "@/lib/church-sms";
import { recordUsage } from "@/lib/usage";
import { issueOtp } from "@/lib/otp";

export const SIGNUP_OTP_PURPOSE = "member_self_update";

const MEMBER_STATUSES = ["active", "inactive", "visitor", "new_convert"] as const;
type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** Public path / URL for a church's self-registration link. */
export function signupPath(slug: string): string {
  return `/join/${slug}`;
}
export function signupUrl(slug: string): string {
  return `${siteUrl()}${signupPath(slug)}`;
}

const RESERVED_SIGNUP_SLUGS = new Set([
  "new",
  "edit",
  "admin",
  "api",
  "join",
  "settings",
]);

/** A globally-unique slug for a church's public sign-up link. */
async function uniqueSignupSlug(base: string): Promise<string> {
  let slug = slugify(base) || "join";
  if (RESERVED_SIGNUP_SLUGS.has(slug)) slug = `${slug}-church`;
  for (let i = 0; i < 6; i++) {
    const [clash] = await db
      .select({ slug: memberSignup.slug })
      .from(memberSignup)
      .where(eq(memberSignup.slug, slug))
      .limit(1);
    if (!clash) return slug;
    slug = `${slugify(base) || "join"}-${randomSuffix(4)}`;
  }
  return `${slugify(base) || "join"}-${randomSuffix(6)}`;
}

/**
 * Fetch a church's sign-up config, creating a default one (with a stable
 * unique slug based on its handle/name) the first time it's needed.
 */
export async function ensureSignup(c: {
  id: string;
  name: string;
  handle: string | null;
}): Promise<MemberSignup> {
  const [existing] = await db
    .select()
    .from(memberSignup)
    .where(eq(memberSignup.churchId, c.id))
    .limit(1);
  if (existing) return existing;

  const slug = await uniqueSignupSlug(c.handle || c.name || "join");
  const [created] = await db
    .insert(memberSignup)
    .values({ churchId: c.id, slug })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  // Lost a race — read the row the other request created.
  const [row] = await db
    .select()
    .from(memberSignup)
    .where(eq(memberSignup.churchId, c.id))
    .limit(1);
  return row;
}

/** Issue a fresh unique slug for a church (invalidates the old public link). */
export async function regenerateSignupSlug(
  churchId: string,
  base: string,
): Promise<string> {
  const slug = await uniqueSignupSlug(`${slugify(base) || "join"}-${randomSuffix(3)}`);
  await db
    .update(memberSignup)
    .set({ slug })
    .where(eq(memberSignup.churchId, churchId));
  return slug;
}

export type PublicSignupData = {
  signup: MemberSignup;
  church: { id: string; name: string; logo: string | null; theme: string };
  groups: { id: string; name: string; type: string }[];
};

/** Everything the public /join/<slug> page needs. Null if slug is unknown. */
export async function getSignupBySlug(
  slug: string,
): Promise<PublicSignupData | null> {
  const [s] = await db
    .select()
    .from(memberSignup)
    .where(eq(memberSignup.slug, slug))
    .limit(1);
  if (!s) return null;

  const [c] = await db
    .select({
      id: church.id,
      name: church.name,
      logo: church.logo,
      theme: church.theme,
    })
    .from(church)
    .where(eq(church.id, s.churchId))
    .limit(1);
  if (!c) return null;

  const groups = s.allowGroupSelect
    ? await db
        .select({ id: group.id, name: group.name, type: group.type })
        .from(group)
        .where(and(eq(group.churchId, s.churchId), eq(group.isActive, true)))
        .orderBy(asc(group.name))
    : [];

  return { signup: s, church: c, groups };
}

/** The fields a person can submit on the public sign-up form. */
export type SignupValues = {
  firstName: string;
  lastName?: string;
  gender?: "male" | "female" | "";
  phone?: string;
  email?: string;
  dateOfBirth?: string;
  weddingDate?: string;
  address?: string;
  city?: string;
  state?: string;
  groupIds?: string[];
};

export type CleanSignup = {
  firstName: string;
  lastName: string | null;
  gender: "male" | "female" | null;
  phone: string | null;
  email: string | null;
  emailNorm: string | null;
  phoneNorm: string | null;
  dateOfBirth: string | null;
  weddingDate: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  groupIds: string[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validate + normalise submitted values. Returns errors or a clean payload. */
export function cleanSignupValues(
  raw: SignupValues,
  signup: MemberSignup,
): { ok: true; value: CleanSignup } | { ok: false; error: string } {
  const firstName = (raw.firstName || "").trim();
  if (!firstName) return { ok: false, error: "Please enter your first name." };

  const email = (raw.email || "").trim();
  if (email && !EMAIL_RE.test(email))
    return { ok: false, error: "Please enter a valid email address." };
  const phone = (raw.phone || "").trim();
  const phoneNorm = phone ? normalizePhone(phone) : null;
  if (phone && !phoneNorm)
    return { ok: false, error: "Please enter a valid phone number." };

  if (!email && !phoneNorm)
    return {
      ok: false,
      error: "Please provide an email address or phone number so we can reach you.",
    };

  // Birthday: the year is optional (day & month is enough), so accept a full
  // date or a year-less MM-DD and store it with the sentinel year.
  const dobRaw = (raw.dateOfBirth || "").trim();
  const dob = dobRaw ? normalizeBirthday(dobRaw) : null;
  if (dobRaw && !dob)
    return { ok: false, error: "Please enter a valid date of birth." };
  const wedding = (raw.weddingDate || "").trim();
  if (wedding && !DATE_RE.test(wedding))
    return { ok: false, error: "Please enter a valid wedding date." };

  const gender =
    raw.gender === "male" || raw.gender === "female" ? raw.gender : null;

  const groupIds = Array.isArray(raw.groupIds)
    ? [...new Set(raw.groupIds.filter((g) => typeof g === "string"))].slice(0, 30)
    : [];

  return {
    ok: true,
    value: {
      firstName: firstName.slice(0, 80),
      lastName: (raw.lastName || "").trim().slice(0, 80) || null,
      gender,
      phone: phone || null,
      email: email || null,
      emailNorm: email ? email.toLowerCase() : null,
      phoneNorm,
      dateOfBirth: signup.collectBirthday ? dob : null,
      weddingDate: signup.collectAnniversary && wedding ? wedding : null,
      address: signup.collectAddress ? (raw.address || "").trim().slice(0, 300) || null : null,
      city: signup.collectAddress ? (raw.city || "").trim().slice(0, 120) || null : null,
      state: signup.collectAddress ? (raw.state || "").trim().slice(0, 120) || null : null,
      groupIds,
    },
  };
}

/** Existing member in this church matching the given email/phone, if any. */
export async function findExistingMember(
  churchId: string,
  emailNorm: string | null,
  phoneNorm: string | null,
): Promise<{ id: string; email: string | null; phone: string | null; status: MemberStatus } | null> {
  if (!emailNorm && !phoneNorm) return null;
  const last = phoneNorm ? phoneNorm.slice(-10) : null;
  const [found] = await db
    .select({
      id: member.id,
      email: member.email,
      phone: member.phone,
      status: member.status,
    })
    .from(member)
    .where(
      and(
        eq(member.churchId, churchId),
        or(
          emailNorm ? sql`lower(${member.email}) = ${emailNorm}` : sql`false`,
          last
            ? and(
                isNotNull(member.phone),
                sql`right(regexp_replace(${member.phone}, '\\D', '', 'g'), 10) = ${last}`,
              )
            : sql`false`,
        ),
      ),
    )
    .limit(1);
  return found ?? null;
}

/** Restrict submitted group ids to real, active groups of this church. */
async function validGroupIds(churchId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: group.id })
    .from(group)
    .where(and(eq(group.churchId, churchId), eq(group.isActive, true)));
  const allowed = new Set(rows.map((r) => r.id));
  return ids.filter((id) => allowed.has(id));
}

async function setGroupMemberships(
  churchId: string,
  memberId: string,
  groupIds: string[],
): Promise<void> {
  const valid = await validGroupIds(churchId, groupIds);
  if (valid.length === 0) return;
  await db
    .insert(groupMembership)
    .values(valid.map((groupId) => ({ groupId, memberId })))
    .onConflictDoNothing();
}

/**
 * Create a brand-new member from a self-registration (no match found).
 * Returns the new member id.
 */
export async function createMemberFromSignup(
  churchId: string,
  data: CleanSignup,
  signup: MemberSignup,
): Promise<string> {
  const status: MemberStatus = MEMBER_STATUSES.includes(
    signup.newMemberStatus as MemberStatus,
  )
    ? (signup.newMemberStatus as MemberStatus)
    : "active";

  const [created] = await db
    .insert(member)
    .values({
      churchId,
      firstName: data.firstName,
      lastName: data.lastName,
      gender: data.gender,
      phone: data.phone,
      email: data.email,
      dateOfBirth: data.dateOfBirth,
      weddingDate: data.weddingDate,
      address: data.address,
      city: data.city,
      state: data.state,
      status,
      joinedAt: sql`current_date`,
    })
    .returning({ id: member.id });

  await setGroupMemberships(churchId, created.id, data.groupIds);
  return created.id;
}

/** Where we can reach a member after a self-registration. */
export type MemberContact = {
  firstName: string;
  email: string | null;
  phone: string | null;
};

/**
 * Apply a verified update to an EXISTING member: overwrite the fields they
 * provided, add the groups they picked, and promote a visitor/new-convert to
 * a full member (the "become a member" conversion).
 *
 * Returns the member's contact details AFTER the update (so a confirmation
 * goes to the address they just gave us, not the one we had on file).
 */
export async function applyVerifiedUpdate(
  churchId: string,
  memberId: string,
  data: CleanSignup,
): Promise<MemberContact | null> {
  const [current] = await db
    .select({ status: member.status })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.churchId, churchId)))
    .limit(1);
  if (!current) return null;

  // Confirming via the sign-up link promotes a visitor/new convert to a member.
  const promote = current.status === "visitor" || current.status === "new_convert";

  // Overwrite only the fields the person actually filled in, so leaving a
  // field blank never wipes existing data.
  const patch: Record<string, unknown> = { firstName: data.firstName };
  if (data.lastName) patch.lastName = data.lastName;
  if (data.gender) patch.gender = data.gender;
  if (data.phone) patch.phone = data.phone;
  if (data.email) patch.email = data.email;
  if (data.dateOfBirth) patch.dateOfBirth = data.dateOfBirth;
  if (data.weddingDate) patch.weddingDate = data.weddingDate;
  if (data.address) patch.address = data.address;
  if (data.city) patch.city = data.city;
  if (data.state) patch.state = data.state;
  if (promote) patch.status = "active";

  const [updated] = await db
    .update(member)
    .set(patch)
    .where(and(eq(member.id, memberId), eq(member.churchId, churchId)))
    .returning({
      firstName: member.firstName,
      email: member.email,
      phone: member.phone,
    });

  await setGroupMemberships(churchId, memberId, data.groupIds);
  return updated ?? null;
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return "your email";
  const head = name.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
}
function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return `••• ••• ${d.slice(-4)}`;
}

/**
 * Send a verification code to an existing member (to authorise updating their
 * record). Prefers email; falls back to SMS when the member has no email.
 * Returns which channel was used + a masked destination for the UI.
 */
export async function sendSignupOtp(opts: {
  churchId: string;
  churchName: string;
  memberId: string;
  memberEmail: string | null;
  memberPhone: string | null;
  payload: Record<string, unknown>;
}): Promise<
  | { ok: true; otpId: string; channel: "email" | "sms"; masked: string }
  | { ok: false; error: string }
> {
  const email = opts.memberEmail?.trim() || null;
  const phone = opts.memberPhone?.trim() || null;

  // Prefer email (free, always available in production).
  if (email && isEmailConfigured()) {
    const issued = await issueOtp({
      churchId: opts.churchId,
      purpose: SIGNUP_OTP_PURPOSE,
      channel: "email",
      destination: email.toLowerCase(),
      memberId: opts.memberId,
      payload: opts.payload,
    });
    if (!issued.ok) return { ok: false, error: issued.error };
    const html = emailLayout(
      "Confirm your details",
      `We received a request to update your details at <b>${opts.churchName}</b>.<br><br>` +
        `Your verification code is:<br>` +
        `<div style="font-size:30px;font-weight:800;letter-spacing:6px;margin:12px 0">${issued.code}</div>` +
        `This code expires in 10 minutes. If this wasn't you, you can ignore this email.`,
    );
    await sendEmail({
      to: email,
      subject: `Your ${opts.churchName} verification code`,
      html,
      text: `Your verification code is ${issued.code}. It expires in 10 minutes.`,
      fromName: opts.churchName,
    }).catch(() => false);
    return { ok: true, otpId: issued.id, channel: "email", masked: maskEmail(email) };
  }

  // Fall back to SMS (needs an approved church sender + wallet balance).
  if (phone) {
    const issued = await issueOtp({
      churchId: opts.churchId,
      purpose: SIGNUP_OTP_PURPOSE,
      channel: "sms",
      destination: normalizePhone(phone) || phone,
      memberId: opts.memberId,
      payload: opts.payload,
    });
    if (!issued.ok) return { ok: false, error: issued.error };
    const res = await sendChurchSms({
      churchId: opts.churchId,
      to: phone,
      message: `${opts.churchName}: your verification code is ${issued.code}. It expires in 10 minutes.`,
      reason: "Member self-registration verification",
    });
    if (!res.ok) {
      return {
        ok: false,
        error:
          "We couldn't send a verification code by SMS. Please contact the church to update your details.",
      };
    }
    return { ok: true, otpId: issued.id, channel: "sms", masked: maskPhone(phone) };
  }

  return {
    ok: false,
    error: "We couldn't find a way to verify this record. Please contact the church.",
  };
}

/** Replace the {name}/{church} placeholders in a confirmation template. */
function fillTemplate(text: string, name: string, churchName: string): string {
  return text
    .replace(/\{name\}/g, name || "there")
    .replace(/\{church\}/g, churchName);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Confirm to the PERSON who just used the sign-up link that we've got their
 * details — by email (free) and/or SMS (costs wallet balance, so opt-in).
 *
 * Each attempt is written to the communication log so it shows up in the
 * church's message history alongside manual sends. Never throws: a failed
 * confirmation must never fail the registration itself.
 */
export async function sendSignupConfirmation(opts: {
  signup: MemberSignup;
  churchId: string;
  churchName: string;
  firstName: string;
  email: string | null;
  phone: string | null;
  /** An existing member confirming an update, rather than a new sign-up. */
  isUpdate?: boolean;
}): Promise<void> {
  const wantsEmail = opts.signup.confirmEmail && !!opts.email;
  const wantsSms = opts.signup.confirmSms && !!opts.phone;
  if (!wantsEmail && !wantsSms) return;

  // A returning member who confirmed an update gets an accurate short note;
  // brand-new people get the church's configured welcome message.
  const body = opts.isUpdate
    ? `Hi ${opts.firstName || "there"}, your details at ${opts.churchName} have been updated. Thank you!`
    : fillTemplate(opts.signup.confirmMessage, opts.firstName, opts.churchName);
  const audience = opts.isUpdate
    ? "Self-registration · details updated"
    : "Self-registration · welcome";

  if (wantsEmail && isEmailConfigured()) {
    const subject = opts.isUpdate
      ? `Your details at ${opts.churchName} have been updated`
      : fillTemplate(opts.signup.confirmSubject, opts.firstName, opts.churchName);
    let ok = false;
    try {
      ok = await sendEmail({
        to: opts.email as string,
        subject,
        html: emailLayout(
          escapeHtml(subject),
          `<p>${escapeHtml(body).replace(/\n/g, "<br/>")}</p>`,
        ),
        text: body,
        fromName: opts.churchName,
      });
    } catch {
      ok = false;
    }
    if (ok) await recordUsage("email", opts.churchId, 1);
    await logConfirmation({
      churchId: opts.churchId,
      channel: "email",
      audience,
      subject,
      body,
      ok,
    });
  }

  if (wantsSms) {
    let ok = false;
    try {
      const res = await sendChurchSms({
        churchId: opts.churchId,
        to: opts.phone as string,
        message: body,
        reason: "Self-registration confirmation",
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    await logConfirmation({
      churchId: opts.churchId,
      channel: "sms",
      audience,
      subject: null,
      body,
      ok,
      units: ok ? smsPages(body) : 0,
    });
  }
}

/** Write one confirmation attempt to the church's message history. */
async function logConfirmation(opts: {
  churchId: string;
  channel: "email" | "sms";
  audience: string;
  subject: string | null;
  body: string;
  ok: boolean;
  units?: number;
}): Promise<void> {
  try {
    await db.insert(communicationLog).values({
      churchId: opts.churchId,
      channel: opts.channel,
      audience: opts.audience,
      subject: opts.subject,
      body: opts.body,
      recipients: 1,
      sent: opts.ok ? 1 : 0,
      failed: opts.ok ? 0 : 1,
      units: opts.units ?? 0,
    });
  } catch {
    /* best-effort */
  }
}

/** Notify church managers about a new/updated self-registration. Never throws. */
export async function notifySignupManagers(opts: {
  signup: MemberSignup;
  churchId: string;
  churchName: string;
  memberId: string;
  personName: string;
  isNew: boolean;
}): Promise<void> {
  if (!opts.signup.notifyInApp && !opts.signup.notifyEmail) return;
  const verb = opts.isNew ? "registered" : "updated their details";
  if (opts.signup.notifyInApp) {
    await notifyChurchManagers({
      churchId: opts.churchId,
      title: opts.isNew ? "New member self-registered" : "Member updated their details",
      body: `${opts.personName} ${verb} via your public sign-up link.`,
      linkUrl: `/members/${opts.memberId}`,
    }).catch(() => {});
  }
  if (opts.signup.notifyEmail && isEmailConfigured()) {
    try {
      const rows = await db
        .select({ email: church.publicEmail })
        .from(church)
        .where(eq(church.id, opts.churchId))
        .limit(1);
      // Managers already get an in-app + push notice; email the church's public
      // inbox if set (keeps this lightweight and avoids per-manager fan-out here).
      const to = rows[0]?.email;
      if (to) {
        await sendEmail({
          to,
          subject: opts.isNew
            ? `New member: ${opts.personName}`
            : `Updated details: ${opts.personName}`,
          html: emailLayout(
            opts.isNew ? "New member self-registered" : "Member updated their details",
            `${opts.personName} ${verb} via your public sign-up link.`,
            { label: "View member", url: `${siteUrl()}/members/${opts.memberId}` },
          ),
          fromName: opts.churchName,
        }).catch(() => false);
      }
    } catch {
      /* best-effort */
    }
  }
}
