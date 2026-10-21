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
  otpCode,
  type MemberSignup,
} from "@/db/schema";
import { normalizePhone, smsPages } from "@/lib/sms";
import { isStorableDate, normalizeBirthday } from "@/lib/birthday";
import { e164Phone, nationalNumber } from "@/lib/phone-intl";
import { normalizeEmail } from "@/lib/email-address";
import { countryProfile } from "@/lib/country-profile";
import { slugify, randomSuffix } from "@/lib/slug";
import { siteUrl } from "@/lib/site";
import { notifyChurchManagers } from "@/lib/notifications";
import { sendEmail, emailLayout, isEmailConfigured } from "@/lib/mailer";
import { sendChurchSms } from "@/lib/church-sms";
import { recordUsage } from "@/lib/usage";
import { issueOtp } from "@/lib/otp";
import { escapeHtml } from "@/lib/html-escape";

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
  church: {
    id: string;
    name: string;
    logo: string | null;
    theme: string;
    /** Decides the dial code a local phone number is read with. */
    country: string;
  };
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
      country: church.country,
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

/** A child a parent adds on the public sign-up form. */
export type ChildValue = {
  firstName: string;
  gender?: "male" | "female" | "";
  dateOfBirth?: string;
};

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
  children?: ChildValue[];
};

export type CleanChild = {
  firstName: string;
  gender: "male" | "female" | null;
  dateOfBirth: string | null;
  relationship: string | null;
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
  children: CleanChild[];
};

/**
 * The dial code a church's members write their numbers in.
 *
 * Read from the church row rather than assumed: every phone path here used to
 * run through `normalizePhone`, which only knows Nigerian numbers, so a member
 * in Maputo typing "84 123 4567" — nine digits, the way everybody there writes
 * it — was told their own number was invalid, and a Kenyan's "0712 345 678"
 * the same. Only typing +258 or +254 got through, and nothing said to.
 */
export async function churchDial(churchId: string): Promise<string> {
  const [c] = await db
    .select({ country: church.country })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  return countryProfile(c?.country).dial;
}

/**
 * Validate + normalise submitted values. Returns errors or a clean payload.
 *
 * `dial` is the church's dial code (see {@link churchDial}), and it is
 * required. It used to be optional, and without it a phone was only checked
 * for having seven digits: a Nigerian number one digit short — which the old
 * Nigeria-only check had always refused — was accepted on /join, /m/<token>
 * and stored as somebody no confirmation or birthday text could ever reach.
 * There is no honest answer to "is this a valid phone number?" without
 * knowing which country's numbers it is, so the caller has to say.
 */
export function cleanSignupValues(
  raw: SignupValues,
  signup: MemberSignup,
  dial: string,
): { ok: true; value: CleanSignup } | { ok: false; error: string } {
  const firstName = (raw.firstName || "").trim();
  if (!firstName) return { ok: false, error: "Please enter your first name." };

  /*
   * The mailer's rule, so what is stored is what can be sent to. The old
   * regex took "name@gmail.com1"; every confirmation and broadcast to it was
   * then refused at send time, and the member was never told.
   */
  const emailRaw = (raw.email || "").trim();
  const email = emailRaw ? normalizeEmail(emailRaw) : null;
  if (emailRaw && !email)
    return { ok: false, error: "Please enter a valid email address — check it for a typo." };
  const phone = (raw.phone || "").trim();
  // E.164 against the church's own country, held to that country's length.
  const phoneNorm = phone ? e164Phone(phone, dial) : null;
  if (phone && !phoneNorm)
    return {
      ok: false,
      error:
        "Please enter a valid phone number (include your country code if it is from another country).",
    };

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
  // A real calendar date, not just the right shape: "1990-02-30" passes a
  // regex and then aborts the insert at Postgres, which on this public form
  // surfaced as a bare server error.
  if (wedding && !isStorableDate(wedding))
    return { ok: false, error: "Please enter a valid wedding date." };

  const gender =
    raw.gender === "male" || raw.gender === "female" ? raw.gender : null;

  const groupIds = Array.isArray(raw.groupIds)
    ? [...new Set(raw.groupIds.filter((g) => typeof g === "string"))].slice(0, 30)
    : [];

  // Children (only when the church collects them). Each needs a first name;
  // gender & birthday are optional, and the relationship is derived from gender.
  const children: CleanChild[] = [];
  if (signup.collectChildren && Array.isArray(raw.children)) {
    for (const rc of raw.children.slice(0, 15)) {
      const cn = (rc?.firstName || "").trim();
      if (!cn) continue;
      const cg = rc.gender === "male" || rc.gender === "female" ? rc.gender : null;
      const cDobRaw = (rc.dateOfBirth || "").trim();
      const cDob = cDobRaw ? normalizeBirthday(cDobRaw) : null;
      if (cDobRaw && !cDob)
        return {
          ok: false,
          error: `Please enter a valid date of birth for ${cn}.`,
        };
      children.push({
        firstName: cn.slice(0, 80),
        gender: cg,
        dateOfBirth: cDob,
        relationship: cg === "male" ? "son" : cg === "female" ? "daughter" : null,
      });
    }
  }

  return {
    ok: true,
    value: {
      firstName: firstName.slice(0, 80),
      lastName: (raw.lastName || "").trim().slice(0, 80) || null,
      gender,
      phone: phone || null,
      email,
      // Already lower-cased by normalizeEmail.
      emailNorm: email,
      phoneNorm,
      dateOfBirth: signup.collectBirthday ? dob : null,
      weddingDate: signup.collectAnniversary && wedding ? wedding : null,
      address: signup.collectAddress ? (raw.address || "").trim().slice(0, 300) || null : null,
      city: signup.collectAddress ? (raw.city || "").trim().slice(0, 120) || null : null,
      state: signup.collectAddress ? (raw.state || "").trim().slice(0, 120) || null : null,
      groupIds,
      children,
    },
  };
}

/**
 * Existing member in this church matching the given email/phone, if any.
 *
 * `phone` may be in any shape — as typed, E.164, or digits — because it is
 * reduced here to its national number with the church's own dial code and
 * compared on THAT number's length. This used to be "the last ten digits",
 * which is a Nigerian number's length and nobody else's: a nine-digit
 * Mozambican or Kenyan national number never matched itself stored another
 * way, and every returning visitor became a second person. `dial` is looked
 * up from the church when the caller does not already have it.
 */
export async function findExistingMember(
  churchId: string,
  emailNorm: string | null,
  phone: string | null,
  dial?: string,
): Promise<{ id: string; email: string | null; phone: string | null; status: MemberStatus } | null> {
  if (!emailNorm && !phone) return null;
  const national = phone
    ? nationalNumber(phone, dial ?? (await churchDial(churchId)))
    : null;
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
          national
            ? and(
                isNotNull(member.phone),
                // The length is a number this function computed, never input,
                // so it is inlined rather than bound.
                sql`right(regexp_replace(${member.phone}, '\\D', '', 'g'), ${sql.raw(String(national.length))}) = ${national}`,
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
 * Register the children a parent added, as members under them (isMinor, linked
 * by guardianId, inheriting the parent's surname). Skips any child whose first
 * name already exists under this guardian, so a re-submit can't duplicate them.
 *
 * Returns how many were created and how many could NOT be — a child already
 * on file is neither. Never throws, because a child failure must not fail the
 * parent's registration; but `failed` is what lets the parent and the
 * managers be told, rather than the screen saying "done" with children
 * missing.
 */
export async function createChildrenForGuardian(
  churchId: string,
  guardianId: string,
  parentLastName: string | null,
  children: CleanChild[],
): Promise<{ created: number; failed: number }> {
  if (!children.length) return { created: 0, failed: 0 };
  let attempted = 0;
  try {
    const existing = await db
      .select({ firstName: member.firstName })
      .from(member)
      .where(
        and(eq(member.churchId, churchId), eq(member.guardianId, guardianId)),
      );
    const have = new Set(existing.map((e) => e.firstName.trim().toLowerCase()));
    const toCreate = children.filter(
      (c) => !have.has(c.firstName.trim().toLowerCase()),
    );
    if (!toCreate.length) return { created: 0, failed: 0 };
    attempted = toCreate.length;
    await db.insert(member).values(
      toCreate.map((c) => ({
        churchId,
        guardianId,
        isMinor: true,
        relationship: c.relationship,
        firstName: c.firstName,
        lastName: parentLastName,
        gender: c.gender,
        dateOfBirth: c.dateOfBirth,
        status: "active" as const,
        joinedAt: sql`current_date`,
      })),
    );
    return { created: toCreate.length, failed: 0 };
  } catch (e) {
    /*
     * Still never fails the parent's registration — but no longer silently.
     * This used to be an empty catch, so a child whose details Postgres
     * refused simply was not registered and the parent was told it worked.
     */
    console.error("[member-signup] createChildrenForGuardian failed", {
      churchId,
      guardianId,
      e,
    });
    // One insert: nothing went in. Before the lookup, assume all of them.
    return { created: 0, failed: attempted || children.length };
  }
}

/** What the person is told when some of their children were not added. */
export const CHILDREN_NOT_ADDED_NOTE =
  "Some of the children you added could not be saved — please tell the church so they can add them.";

/**
 * Tell the managers that a parent's children did not go in.
 *
 * Sent whatever the sign-up's notification settings say: those are about
 * "somebody registered", which the church may not want to hear about; this is
 * "somebody's children are missing from your register", which only a person
 * can put right.
 */
async function tellManagersChildrenMissing(
  churchId: string,
  guardianId: string,
  failed: number,
): Promise<void> {
  try {
    await notifyChurchManagers({
      churchId,
      title: "Children from a sign-up were not added",
      body: `${failed} child${failed === 1 ? "" : "ren"} submitted on your public sign-up link could not be saved. Open the parent's record and add them by hand.`,
      linkUrl: `/members/${guardianId}`,
    });
  } catch (e) {
    console.error("[member-signup] children-missing notice failed", { churchId, guardianId, e });
  }
}

/**
 * Create a brand-new member from a self-registration (no match found).
 * Returns the new member id. Prefer {@link registerFromSignup}, which also
 * says whether any of their children could not be added.
 */
export async function createMemberFromSignup(
  churchId: string,
  data: CleanSignup,
  signup: MemberSignup,
): Promise<string> {
  return (await registerFromSignup(churchId, data, signup)).id;
}

/**
 * Create a brand-new member from a self-registration, and report how many of
 * the children they added could not be saved — so the screen can say so
 * instead of "done". The managers are told either way.
 */
export async function registerFromSignup(
  churchId: string,
  data: CleanSignup,
  signup: MemberSignup,
): Promise<{ id: string; childrenNotAdded: number }> {
  const status: MemberStatus = MEMBER_STATUSES.includes(
    signup.newMemberStatus as MemberStatus,
  )
    ? (signup.newMemberStatus as MemberStatus)
    : "active";

  // Stored as E.164 against the church's own country, so every later match,
  // text and export reads the same number the same way.
  const phone = data.phone
    ? (e164Phone(data.phone, await churchDial(churchId)) ?? data.phone)
    : null;

  const [created] = await db
    .insert(member)
    .values({
      churchId,
      firstName: data.firstName,
      lastName: data.lastName,
      gender: data.gender,
      phone,
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
  const kids = await createChildrenForGuardian(
    churchId,
    created.id,
    data.lastName,
    data.children,
  );
  if (kids.failed > 0) await tellManagersChildrenMissing(churchId, created.id, kids.failed);
  return { id: created.id, childrenNotAdded: kids.failed };
}

/** Where we can reach a member after a self-registration. */
export type MemberContact = {
  firstName: string;
  email: string | null;
  phone: string | null;
  /**
   * Children they added that could not be saved. Non-zero means the success
   * message must add {@link CHILDREN_NOT_ADDED_NOTE}; the managers have
   * already been told.
   */
  childrenNotAdded: number;
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
  if (data.phone)
    patch.phone = e164Phone(data.phone, await churchDial(churchId)) ?? data.phone;
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
      lastName: member.lastName,
      email: member.email,
      phone: member.phone,
    });

  await setGroupMemberships(churchId, memberId, data.groupIds);
  // Register any children they added, under this (now-verified) member.
  const kids = await createChildrenForGuardian(
    churchId,
    memberId,
    updated?.lastName ?? data.lastName,
    data.children,
  );
  if (kids.failed > 0) await tellManagersChildrenMissing(churchId, memberId, kids.failed);
  if (!updated) return null;
  return {
    firstName: updated.firstName,
    email: updated.email,
    phone: updated.phone,
    childrenNotAdded: kids.failed,
  };
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
    /*
     * Read the answer. This used to be `.catch(() => false)` with the result
     * thrown away, so a Resend 429 still told the person "we sent a code to
     * jo**@…" — a code that never came, for a form they then could not finish.
     */
    let sent = false;
    try {
      sent = await sendEmail({
        to: email,
        subject: `Your ${opts.churchName} verification code`,
        html,
        text: `Your verification code is ${issued.code}. It expires in 10 minutes.`,
        fromName: opts.churchName,
      });
    } catch (e) {
      console.error("[member-signup] verification email threw", e);
    }
    if (sent)
      return { ok: true, otpId: issued.id, channel: "email", masked: maskEmail(email) };

    console.error(
      `[member-signup] verification email failed for member ${opts.memberId} (church ${opts.churchId})`,
    );
    // Retire the undelivered code, so it does not count against the
    // live-codes-per-destination throttle when they try again in a minute.
    await db
      .update(otpCode)
      .set({ consumedAt: new Date() })
      .where(eq(otpCode.id, issued.id));
    if (!phone)
      return {
        ok: false,
        error:
          "We couldn't send your verification code by email just now. Please try again in a minute, or contact the church.",
      };
    // Otherwise fall through and try the phone on file instead.
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
    /*
     * A code, so never queued.
     *
     * It expires in ten minutes. Holding it until 8am would mean telling
     * somebody standing in the church foyer to expect a text that arrives
     * tomorrow and is dead when it does. "refuse" says plainly that SMS
     * cannot carry it right now and points at email, which can.
     */
    const res = await sendChurchSms({
      churchId: opts.churchId,
      to: phone,
      message: `${opts.churchName}: your verification code is ${issued.code}. It expires in 10 minutes.`,
      reason: "Member self-registration verification",
      timing: "refuse",
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
        origin: "member-signup",
      });
      // Queued counts as accepted: the queue sends it in the morning, and the
      // person has already seen their confirmation on screen.
      ok = res.ok !== false;
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
    }).catch((e: unknown) => {
      console.error(
        `member-signup: manager notify failed for church ${opts.churchId}`,
        e,
      );
    });
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
