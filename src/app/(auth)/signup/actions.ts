"use server";

import { cookies, headers } from "next/headers";
import { eq, inArray, or, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/geo";
import {
  countryFromIso2,
  countryProfile,
  currencyForCountry,
  timezoneForCountry,
  localeForCountry,
} from "@/lib/country-profile";
import { LOCALE_COOKIE } from "@/lib/i18n/locales";
import { church, partner, staff, session as sessionTable, user } from "@/db/schema";
import { slugify, randomSuffix } from "@/lib/slug";
import { ensureMemberForUser } from "@/lib/member-link";
import { TRIAL_PLAN, trialEndDate } from "@/lib/trial";
import { REFERRAL_COOKIE, normaliseCode } from "@/lib/referral";
import { PARTNER_COOKIE } from "@/lib/partner-link";
import { normalisePartnerCode } from "@/lib/partners-shared";
import { attributeChurch } from "@/lib/partners";
import { internationalPhone, phoneMatchCandidates } from "@/lib/phone-intl";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { cleanOrgType } from "@/lib/org-type";

export type SignUpResult =
  | { ok: true; signedIn: boolean }
  | { ok: false; error: string; needsOnboarding?: boolean };

function errorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === "object") {
    const body = (e as { body?: { message?: string } }).body;
    if (body?.message) return body.message;
    const msg = (e as { message?: string }).message;
    if (msg) return msg;
  }
  return fallback;
}

function isUniqueViolation(e: unknown): boolean {
  // Postgres unique_violation. Surfaces on the error or a nested cause.
  const code =
    (e as { code?: string })?.code ??
    (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

/**
 * Create a church account in one server-side step.
 *
 * Why this lives on the server: when email verification is required,
 * `signUpEmail` intentionally returns no session (`token: null`) until the
 * user verifies. The old client flow then called `organization.create()`
 * with no session and got a 401 ("church setup failed"). Creating the church
 * here — tied directly to the new user — works whether or not a session
 * exists. After the user verifies and logs in, the session-create hook in
 * `auth.ts` auto-selects this church as their active tenant.
 */
export async function createChurchAccount(input: {
  /** The organisation's name — a church's, a fellowship's, a mission's. */
  churchName: string;
  /**
   * What kind of organisation it is (lib/org-type.ts). Optional, and anything
   * not on the list is stored as "church", so an older client that never sends
   * it signs up exactly as it always did.
   */
  orgType?: string;
  name: string;
  email: string;
  password: string;
  /** Chosen on the form, pre-filled from Cloudflare's guess. */
  country?: string;
  /**
   * The church's own number, optional on the form.
   *
   * Asked for because the two things support most often needs and cannot get
   * are a number to call and a verified email, and because a trial that goes
   * quiet is a conversation rather than a lost cause — if there is any way to
   * have it.
   */
  phone?: string;
  /**
   * A Partner's code, or a referring church's handle, typed in by hand.
   *
   * The link at `/a/<code>` already captures this in a cookie, and that keeps
   * working. This is for the half of it a link cannot reach: an agent sitting
   * with a pastor, reading six characters off a card into a form on the
   * pastor's own phone.
   */
  referralCode?: string;
}): Promise<SignUpResult> {
  const churchName = input.churchName.trim();
  const name = input.name.trim();
  const email = input.email.trim();

  /*
   * Trust the form over the header. Cloudflare only pre-fills the field; a
   * Nigerian pastor planting in Mozambique, or anyone behind a VPN, must be
   * able to say otherwise and be believed.
   */
  const country = cleanCountry(input.country);
  const orgType = cleanOrgType(input.orgType);

  if (!churchName || !name || !email || !input.password) {
    return { ok: false, error: "Please fill in every field." };
  }

  /*
   * Ten an hour from one address, and a ceiling on the whole platform.
   *
   * Each attempt creates a real account, a church on a fresh trial, staff and
   * member rows, and can send a FlockInsight email to whatever address was
   * typed. Better Auth's own limiter does not cover this: it runs in its HTTP
   * router, and `auth.api.signUpEmail` below is a direct call. An honest
   * pastor needs one attempt, two with a typo, and an agent signing up several
   * churches from one office is still well inside ten. The platform ceiling is
   * what stops a script that rotates addresses, and it says so in the log.
   */
  if (!rateLimit(`signup:${await clientIp()}`, 10, 60 * 60_000).ok) {
    return {
      ok: false,
      error: "Too many sign-ups from this connection. Try again in an hour.",
    };
  }
  if (!rateLimit("signup:all", 100, 60 * 60_000).ok) {
    console.error("[signup] more than 100 church sign-ups in an hour; refusing until the hour is up");
    return {
      ok: false,
      error: "We're getting an unusual number of sign-ups right now. Please try again in an hour.",
    };
  }

  /*
   * The phone number and the referral code are both settled BEFORE anything is
   * created, because either one can be refused.
   *
   * Refusing after `signUpEmail` would leave a real user account behind for a
   * church that was never created — and the person, told to check the code and
   * try again, would then find their own email address already taken by the
   * attempt that failed. That is a dead end you cannot talk somebody out of.
   */
  const contactPhone = input.phone?.trim()
    ? internationalPhone(input.phone, countryProfile(country).dial)
    : null;
  if (input.phone?.trim() && !contactPhone) {
    return {
      ok: false,
      error: "That phone number looks incomplete. Check it, or leave it blank.",
    };
  }

  /*
   * A code that was typed and resolves to nobody stops the form.
   *
   * The alternative is to ignore it and carry on, which means an agent loses a
   * commission months later over one mistyped character, with nothing anywhere
   * that says why. Saying so costs the pastor five seconds and is undone by
   * emptying the box.
   */
  let typed: ResolvedReferral | null = null;
  const typedReferral = (input.referralCode ?? "").trim();
  if (typedReferral) {
    try {
      typed = await resolveReferral(typedReferral);
    } catch (e) {
      /*
       * Could not check, which is not the same as "not a code". Saying so and
       * stopping is the only answer that is not a lie: carrying on would drop
       * the attribution silently, and refusing it outright would accuse them
       * of a typo they did not make.
       */
      console.error("[signup] could not check the referral code", e);
      return {
        ok: false,
        error:
          "We couldn't check that referral code just now. Try again in a moment.",
      };
    }
  }
  if (typedReferral && !typed) {
    return {
      ok: false,
      error:
        "We don't recognise that referral code. Check it with whoever gave it to you, or clear the box to carry on.",
    };
  }

  // 1) Create the user account. With email verification enabled this does
  //    NOT sign the user in; it also fires the verification email.
  let signUp;
  try {
    signUp = await auth.api.signUpEmail({
      body: { email, password: input.password, name },
      headers: await headers(),
    });
  } catch (e) {
    return { ok: false, error: errorMessage(e, "Could not create your account.") };
  }

  const userId = signUp?.user?.id;
  if (!userId) {
    return { ok: false, error: "Could not create your account." };
  }

  // Guard against Better Auth's anti-enumeration response: when the email is
  // already registered (and verification is on) it returns a *synthetic* user
  // whose id is not in the database. Don't create an orphan church for it.
  const [realUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!realUser) {
    return {
      ok: false,
      error: "That email is already registered. Please log in instead.",
    };
  }

  // 2) Create the church (organization) + owner membership, atomically, so a
  //    failure never leaves a church without its owner.
  const churchId = crypto.randomUUID();
  const base = slugify(churchName) || "church";
  let slug = base;

  /*
   * Who sent them, if anyone.
   *
   * A code they TYPED wins over a cookie: one was declared by the person in
   * front of us, the other is a side effect of a link somebody clicked up to
   * thirty days ago. The cookie is read here rather than trusted from the
   * client, and verified to be a real church, so a hand-edited one cannot
   * credit a church that does not exist.
   */
  const referredByChurchId =
    typed?.kind === "church"
      ? typed.churchId
      : await (async () => {
          const raw = (await cookies()).get(REFERRAL_COOKIE)?.value;
          if (!raw) return null;
          const [row] = await db
            .select({ id: church.id })
            .from(church)
            .where(eq(church.id, raw))
            .limit(1);
          return row?.id ?? null;
        })();

  /*
   * And which PARTNER brought them, if any — the field agent who signs
   * churches up and earns on what they pay. Set by /a/<code> up to 30 days
   * ago, and read here rather than trusted from the client.
   *
   * Separate from the church-to-church referral above, and both can be true:
   * one church may recommend another while an agent walks them through it.
   */
  const partnerCode =
    typed?.kind === "partner"
      ? typed.code
      : ((await cookies()).get(PARTNER_COOKIE)?.value ?? null);

  for (let attempt = 0; ; attempt++) {
    try {
      await db.transaction(async (tx) => {
        // `handle` (public URL) defaults to the slug; the church can change it.
        await tx.insert(church).values({
          id: churchId,
          name: churchName,
          orgType,
          slug,
          handle: slug,
          // Seed the account contact so the verification page opens pre-filled.
          // Left unverified: Better Auth verifies the PERSON's login email,
          // which is a different claim from the CHURCH owning this address.
          contactEmail: email.toLowerCase(),
          /*
           * And the number, on the same terms: seeded, unverified.
           *
           * It goes on the CHURCH rather than on the person's own
           * `user.phone`, which is only ever written at the moment a code sent
           * to it comes back — a verified stamp there always refers to the
           * number printed beside it, and seeding an unproved number would
           * make that untrue. Here the pair is `contactPhone` +
           * `phoneVerifiedAt`, the stamp stays null, and Settings → Account
           * verification asks for the code whenever they get to it.
           */
          contactPhone,
          /*
           * Country decides money and language, so it is set at creation
           * rather than left to default.
           *
           * Every church used to be created as Nigerian: naira in its giving
           * screens, English on every page, and an SMS button that would take
           * its money and deliver nothing. A church in Maputo now starts in
           * meticais and Portuguese, which is the difference between software
           * that was built for you and software you have to correct.
           */
          country,
          currency: currencyForCountry(country),
          /*
           * And its clock. Birthday greetings, service reminders and pledge
           * reminders all ask "what is today, there" — a Maputo church left
           * on Africa/Lagos has an hour of every day filed under the wrong
           * date, so a member born just after midnight is greeted a day late
           * every year. Changeable in Settings; right from the first minute.
           */
          timezone: timezoneForCountry(country),
          // Start the "first 7 Sundays free" trial from today, with every
          // Pro feature on for it (lib/trial.ts).
          trialEndsAt: trialEndDate(new Date()),
          plan: TRIAL_PLAN,
          referredByChurchId,
          referredAt: referredByChurchId ? new Date() : null,
        });
        await tx.insert(staff).values({
          id: crypto.randomUUID(),
          organizationId: churchId,
          userId,
          role: "owner",
        });

        /*
         * Start them in their own language too.
         *
         * Set on the ACCOUNT rather than only in a cookie, so it survives the
         * verification email round trip and the next device. The cookie is
         * written below for this browser, because a Mozambican pastor should
         * not have to read an English confirmation page to find the language
         * picker.
         */
        const locale = localeForCountry(country);
        if (locale !== "en") {
          await tx.update(user).set({ locale }).where(eq(user.id, userId));
        }
      });
      break;
    } catch (e) {
      // Slug collision → retry a few times with a random suffix.
      if (isUniqueViolation(e) && attempt < 4) {
        slug = `${base}-${randomSuffix()}`;
        continue;
      }
      return {
        ok: false,
        error: "Account created, but setting up your organisation failed. You can finish setup now.",
        needsOnboarding: true,
      };
    }
  }

  /*
   * Switch this browser to their language now, not on next sign-in.
   *
   * The account already carries the locale, but the very next thing they see
   * is a verification page — and asking somebody to read English instructions
   * in order to find the language picker is the wrong first impression for a
   * product that claims to speak their language.
   */
  const locale = localeForCountry(country);
  if (locale !== "en") {
    (await cookies()).set(LOCALE_COOKIE, locale, {
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
    });
  }

  // The owner is also a person in the congregation — create their member
  // profile so they aren't duplicated later.
  await ensureMemberForUser(churchId, userId);

  /*
   * Credit the Partner who brought them, if a code was captured.
   *
   * Outside the transaction and never allowed to throw: the church exists and
   * its owner is in place, and a failure to record who referred them must not
   * undo that. Attribution is decided once — the table is unique on the church
   * — so a replay cannot re-point it, and an unknown code simply does nothing.
   */
  if (partnerCode) {
    try {
      await attributeChurch({
        churchId,
        code: partnerCode,
        source: typed?.kind === "partner" ? "code" : "link",
      });
    } catch (e) {
      console.error("[partners] could not record who referred this church", e);
    }
  }

  // 3) If sign-up created a session (verification disabled → auto sign-in),
  //    point it at the new church so the user lands in-context. When
  //    verification is required there is no session yet — the login hook
  //    handles it later.
  const updated = await db
    .update(sessionTable)
    .set({ activeOrganizationId: churchId })
    .where(eq(sessionTable.userId, userId))
    .returning({ id: sessionTable.id });

  const signedIn = updated.length > 0;

  // No session means email verification is required → send the link now
  // (global auto-send is off; the login page also offers a resend fallback).
  if (!signedIn) {
    try {
      await auth.api.sendVerificationEmail({
        body: { email },
        headers: await headers(),
      });
    } catch (e) {
      console.error("sendVerificationEmail (signup) failed", e);
    }
  }

  return { ok: true, signedIn };
}

/* ============================================================
 * Telling somebody something is already taken, while they are still typing
 *
 * Three questions the form can ask before it is submitted: does this email
 * already have an account, does this phone number, and whose referral code is
 * this. Each one is a question about data that is not the asker's, so each one
 * is answered as narrowly as it can be and all three share one ceiling.
 *
 * The email answer is the one to be careful about, and the honest reason it is
 * allowed is that the form already gives it away on submit — "That email is
 * already registered. Please log in instead." A sign-up page that lets you
 * discover that after one round trip is not made safer by making you wait for
 * the round trip; it is only made worse to use. What the ceiling protects
 * against is the form being used to TEST A LIST, which is a different thing
 * from one person checking one address.
 *
 * Nothing here can ever block the form. When the answer is not available —
 * rate-limited, or the query failed — it says `cannotSay` and the field stays
 * silent, because a check that cannot run is not a reason to stop somebody
 * signing up.
 * ========================================================== */

export type FieldCheck =
  /** Nothing on file. */
  | { state: "free" }
  /** Already on an account. For email that blocks; for phone it only warns. */
  | { state: "taken"; message: string }
  | { state: "invalid"; message: string }
  /** We could not answer. The field says nothing at all. */
  | { state: "cannotSay" };

/**
 * Forty lookups per address per ten minutes.
 *
 * A person filling this form in honestly uses three or four. Forty leaves room
 * for a shared church wifi, a corrected typo and a browser that fires a blur
 * twice, while capping a script at a rate that makes testing a list of
 * addresses pointless.
 */
async function lookupAllowed(): Promise<boolean> {
  return rateLimit(`signup-check:${await clientIp()}`, 40, 10 * 60_000).ok;
}

/** Whatever arrived, turned into a country we actually serve. */
function cleanCountry(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  return COUNTRIES.includes(value) ? value : DEFAULT_COUNTRY;
}

/** Does this email address already have a FlockInsight account? */
export async function checkSignupEmail(email: string): Promise<FieldCheck> {
  const value = (email ?? "").trim().toLowerCase();
  if (!value) return { state: "cannotSay" };

  // A half-typed address is not a question worth putting to the database, and
  // "free" would be a misleading answer to it.
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    return {
      state: "invalid",
      message: "That doesn't look like a complete email address.",
    };
  }

  if (!(await lookupAllowed())) return { state: "cannotSay" };

  try {
    const [row] = await db
      .select({ id: user.id })
      .from(user)
      // Lower-cased on both sides: Better Auth stores what it was given, and
      // an address that differs only in case is the same mailbox.
      .where(sql`lower(${user.email}) = ${value}`)
      .limit(1);
    if (!row) return { state: "free" };
    return {
      state: "taken",
      message: "That email already has a FlockInsight account.",
    };
  } catch (e) {
    console.error("[signup] email lookup failed", e);
    return { state: "cannotSay" };
  }
}

/**
 * Is this phone number already on an account?
 *
 * A WARNING, never a refusal, and the difference matters: two churches sharing
 * a line, a pastor who plants a second assembly, and a secretary who signs both
 * up are all ordinary, while an email address really can only belong to one
 * login. So the form says what it found and lets them carry on.
 *
 * It looks at the church's own contact number and at the numbers people have
 * verified on their own accounts. It does NOT look at `member.phone` — the
 * congregation's numbers. Answering "yes, somebody has that number" from the
 * member register would turn an unauthenticated form into a way to ask whether
 * a particular person is in somebody's church, which is not a question this
 * page gets to answer.
 */
export async function checkSignupPhone(
  phone: string,
  country?: string,
): Promise<FieldCheck> {
  const typed = (phone ?? "").trim();
  if (!typed) return { state: "cannotSay" };

  const dial = countryProfile(cleanCountry(country)).dial;
  if (!internationalPhone(typed, dial)) {
    return {
      state: "invalid",
      message: "That phone number looks incomplete — check the digits.",
    };
  }

  if (!(await lookupAllowed())) return { state: "cannotSay" };

  const candidates = phoneMatchCandidates(typed, dial);
  if (candidates.length === 0) return { state: "cannotSay" };

  try {
    const [onChurch] = await db
      .select({ id: church.id })
      .from(church)
      .where(inArray(church.contactPhone, candidates))
      .limit(1);
    const [onUser] = onChurch
      ? []
      : await db
          .select({ id: user.id })
          .from(user)
          .where(inArray(user.phone, candidates))
          .limit(1);

    if (!onChurch && !onUser) return { state: "free" };
    return {
      state: "taken",
      message:
        "We already have an account with this number. If it's yours, log in instead of starting again.",
    };
  } catch (e) {
    console.error("[signup] phone lookup failed", e);
    return { state: "cannotSay" };
  }
}

/* ============================================================
 * The referral code
 * ========================================================== */

export type ReferralCheck =
  | { state: "empty" }
  | { state: "ok"; kind: "partner" | "church"; code: string; label: string }
  | { state: "unknown" }
  | { state: "cannotSay" };

type ResolvedReferral =
  | { kind: "partner"; code: string; label: string }
  | { kind: "church"; churchId: string; code: string; label: string };

/**
 * Whose code is this?
 *
 * One box, two programmes behind it, because a pastor handed a code has no
 * reason to know which kind it is. A Partner's code is tried first — that is
 * the one with cash behind it — and a church's own handle second.
 *
 * They cannot realistically collide: a Partner code is six characters from an
 * alphabet with no vowels, so it cannot spell the sort of word a church puts in
 * its handle, and `normaliseCode` refuses anything that is not handle-shaped.
 */
async function resolveReferral(raw: string): Promise<ResolvedReferral | null> {
  const typed = (raw ?? "").trim();
  if (!typed) return null;

  const code = normalisePartnerCode(typed);
  if (code) {
    const [p] = await db
      .select({ code: partner.code, displayName: partner.displayName })
      .from(partner)
      .where(eq(partner.code, code))
      .limit(1);
    // A suspended Partner still resolves. Whether they get PAID is answered
    // when the church pays; losing the record of who brought it would make
    // that question unanswerable later.
    if (p) return { kind: "partner", code: p.code, label: p.displayName };
  }

  const handle = normaliseCode(typed);
  if (handle) {
    const [c] = await db
      .select({
        id: church.id,
        name: church.name,
        handle: church.handle,
        slug: church.slug,
      })
      .from(church)
      .where(or(eq(church.handle, handle), eq(church.slug, handle)))
      .limit(1);
    if (c) {
      return {
        kind: "church",
        churchId: c.id,
        code: c.handle || c.slug,
        label: c.name,
      };
    }
  }

  return null;
}

/**
 * Check a typed referral code and say whose it is.
 *
 * Naming the Partner or the church back to the person is the point: a code is
 * read down a phone line and written on the back of a card, and a mistyped
 * character would otherwise cost an agent a commission silently, months later,
 * with nobody able to work out what went wrong.
 */
export async function checkReferralCode(code: string): Promise<ReferralCheck> {
  const typed = (code ?? "").trim();
  if (!typed) return { state: "empty" };
  if (!(await lookupAllowed())) return { state: "cannotSay" };
  try {
    const found = await resolveReferral(typed);
    if (!found) return { state: "unknown" };
    return {
      state: "ok",
      kind: found.kind,
      code: found.code,
      label: found.label,
    };
  } catch (e) {
    console.error("[signup] referral lookup failed", e);
    return { state: "cannotSay" };
  }
}

/**
 * The referral this browser already carries, so the form can show it.
 *
 * Somebody who followed `/a/bc3k9m` has the attribution in an httpOnly cookie
 * and no way to see it. Filling the box in and naming who gets the credit turns
 * an invisible mechanism into something they can confirm — or clear, which is
 * the other half of it: a cookie from a link somebody clicked three weeks ago
 * should not quietly credit an agent they have never spoken to.
 *
 * Reads only this caller's own cookies, so there is nothing here to rate-limit.
 */
export async function capturedReferral(): Promise<
  { kind: "partner" | "church"; code: string; label: string } | null
> {
  const jar = await cookies();
  try {
    const partnerCode = jar.get(PARTNER_COOKIE)?.value;
    if (partnerCode) {
      const found = await resolveReferral(partnerCode);
      if (found?.kind === "partner") return found;
    }

    // The church cookie holds an id rather than a code, so it is looked up
    // directly rather than through the resolver.
    const churchId = jar.get(REFERRAL_COOKIE)?.value;
    if (churchId) {
      const [c] = await db
        .select({ name: church.name, handle: church.handle, slug: church.slug })
        .from(church)
        .where(eq(church.id, churchId))
        .limit(1);
      if (c) {
        return { kind: "church", code: c.handle || c.slug, label: c.name };
      }
    }
  } catch (e) {
    console.error("[signup] could not read the captured referral", e);
  }
  return null;
}

/**
 * Where Cloudflare thinks this visitor is.
 *
 * Only ever a suggestion for the form's initial value. It costs nothing —
 * `CF-IPCountry` is already on every request — and it is right far more often
 * than a dropdown defaulting to Nigeria for the whole world. When it is wrong,
 * which a VPN or a travelling pastor makes certain, the person simply picks
 * another and is believed.
 */
export async function detectCountry(): Promise<string | null> {
  const h = await headers();
  return countryFromIso2(h.get("cf-ipcountry"));
}
