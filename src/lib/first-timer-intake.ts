import "server-only";
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { church, firstTimerSignup, member } from "@/db/schema";
import { findExistingMember } from "@/lib/member-signup";
import { normalizePhone } from "@/lib/sms";
import { randomSuffix, slugify } from "@/lib/slug";
import { siteUrl } from "@/lib/site";
import {
  cleanIntake,
  type FirstTimerIntake,
  type CleanIntake,
} from "@/lib/first-timer-shared";

/**
 * Registering a first-time worshipper.
 *
 * One church put the problem like this: "Can we have registration of
 * first-time worshippers on its own, not under membership, because it's
 * really making my people confused and they are messing up the thing."
 *
 * The mess was mechanical. To write a visitor down you opened Members → Add —
 * twenty-five fields, including household, baptism date and wedding
 * anniversary, and a status dropdown that DEFAULTS TO ACTIVE. Miss that one
 * field and the person is filed as a full member, which costs three things
 * silently:
 *
 *   - they never appear in Follow-up, which reads
 *     `status in ('visitor','new_convert') or in_follow_up`
 *   - the first-timer welcome and invite messages never fire, which read
 *     `status in ('visitor','new_convert')`
 *   - the membership count is overstated
 *
 * Nothing errors. The church only finds out when somebody notices nobody ever
 * called the people who came last month.
 *
 * So this is the one way in, used by the staff form and by the public link
 * alike, and it has NO status argument. Everything through here is a visitor,
 * in follow-up, from the first keystroke. They still land in the same `member`
 * table, so Members, attendance, the exports and the reports see exactly what
 * they saw before.
 */

export type { FirstTimerIntake, CleanIntake };

/* ------------------------------------------------------------------ *
 * The public link
 * ------------------------------------------------------------------ */

/** Public path / URL for a church's first-timer link. */
export function welcomePath(slug: string): string {
  return `/welcome/${slug}`;
}
export function welcomeUrl(slug: string): string {
  return `${siteUrl()}${welcomePath(slug)}`;
}

/*
 * Words that must never become somebody's slug, because `/welcome/<slug>`
 * would then shadow a real page or read as one.
 */
const RESERVED_WELCOME_SLUGS = new Set([
  "new",
  "edit",
  "admin",
  "api",
  "join",
  "welcome",
  "settings",
  "first-timers",
]);

async function uniqueWelcomeSlug(base: string): Promise<string> {
  const root = slugify(base).slice(0, 40) || "welcome";
  let candidate = RESERVED_WELCOME_SLUGS.has(root) ? `${root}-${randomSuffix(3)}` : root;

  // Ten attempts, then a long random one. A collision needs another church to
  // hold the name already; the fallback cannot realistically collide.
  for (let i = 0; i < 10; i++) {
    const [taken] = await db
      .select({ slug: firstTimerSignup.slug })
      .from(firstTimerSignup)
      .where(eq(firstTimerSignup.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
    candidate = `${root}-${randomSuffix(3)}`;
  }
  return `${root}-${randomSuffix(8)}`;
}

/**
 * The church's first-timer link config, created on first use.
 *
 * Created DISABLED. A public endpoint that writes rows into a church's
 * register is not something to switch on for everybody and hope they notice
 * the page they have just published.
 */
export async function ensureFirstTimerSignup(c: {
  id: string;
  name: string;
  handle: string | null;
}) {
  const [existing] = await db
    .select()
    .from(firstTimerSignup)
    .where(eq(firstTimerSignup.churchId, c.id))
    .limit(1);
  if (existing) return existing;

  const slug = await uniqueWelcomeSlug(c.handle || c.name || "welcome");
  const [created] = await db
    .insert(firstTimerSignup)
    .values({ churchId: c.id, slug })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost a race — read the row the other request created.
  const [row] = await db
    .select()
    .from(firstTimerSignup)
    .where(eq(firstTimerSignup.churchId, c.id))
    .limit(1);
  return row;
}

/** Issue a fresh slug, which invalidates every printed QR code. */
export async function regenerateWelcomeSlug(
  churchId: string,
  base: string,
): Promise<string> {
  const slug = await uniqueWelcomeSlug(`${slugify(base) || "welcome"}-${randomSuffix(3)}`);
  await db
    .update(firstTimerSignup)
    .set({ slug })
    .where(eq(firstTimerSignup.churchId, churchId));
  return slug;
}

export type PublicWelcomeData = {
  signup: typeof firstTimerSignup.$inferSelect;
  church: { id: string; name: string; logo: string | null; theme: string };
};

/**
 * Everything the public page needs, or null.
 *
 * Null for an unknown slug AND for a disabled one, deliberately — the same
 * answer either way, so the page cannot be used to discover which churches
 * exist and have simply turned theirs off.
 */
export async function getWelcomeBySlug(
  slug: string,
): Promise<PublicWelcomeData | null> {
  const [s] = await db
    .select()
    .from(firstTimerSignup)
    .where(and(eq(firstTimerSignup.slug, slug), eq(firstTimerSignup.enabled, true)))
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

  return { signup: s, church: c };
}

/* ------------------------------------------------------------------ *
 * Registering
 * ------------------------------------------------------------------ */

export type IntakeOutcome =
  /** A new person is on the register, in follow-up. */
  | { outcome: "created"; memberId: string }
  /**
   * Somebody with this phone or email is already on the register. No second
   * row was made; they were put into follow-up and any blanks were filled.
   */
  | { outcome: "matched"; memberId: string; alreadyInFollowUp: boolean };

/**
 * Register a first-time worshipper, or recognise one we already know.
 *
 * The matching half matters more than the creating half. A welcome desk is
 * the single most duplicate-prone place in a church app: the same visitor
 * comes three Sundays running and gets written down three times, and six
 * weeks later nobody can tell whether that is one person or three. So a phone
 * number or email that is already on the register never makes a second row.
 *
 * What it does to the person it recognised is deliberately timid:
 *
 *   - blanks are filled, and nothing that has a value is ever overwritten.
 *     Somebody at a desk with a biro is not a better source than what the
 *     church already recorded, and a half-heard surname must not replace a
 *     correct one.
 *   - their STATUS is never changed. An active member who fills in a welcome
 *     card has not stopped being a member, and demoting them to visitor would
 *     drop them out of the membership count and into the first-timer
 *     automation — a stranger's welcome message to someone who has been there
 *     for years.
 *   - they are put into follow-up, because somebody did just ask to be
 *     followed up with.
 */
export async function registerFirstTimer(opts: {
  churchId: string;
  intake: FirstTimerIntake;
  /** Who keyed it in. Null for the public link. */
  createdBy?: string | null;
  /**
   * May this fill in blanks on somebody who is ALREADY on the register?
   *
   * True for a signed-in member of staff, who is trusted and accountable.
   * FALSE for the public link, and that difference is load-bearing: matching
   * is done on phone number and email, neither of which is a secret. Without
   * this flag a stranger could type a member's phone number into a church's
   * public welcome form and have their own email, address and notes written
   * into that member's record wherever the church had left a field blank —
   * an unauthenticated write to somebody else's data.
   *
   * With it false, a match does exactly one thing: flags the person for
   * follow-up. Somebody did just ask to be contacted, and a human will look.
   */
  allowPatchExisting?: boolean;
}): Promise<{ ok: true; result: IntakeOutcome } | { ok: false; error: string }> {
  const parsed = cleanIntake(opts.intake);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const d = parsed.value;
  const allowPatch = opts.allowPatchExisting !== false;

  /*
   * The inviter must be a member of THIS church.
   *
   * `cleanIntake` only checks the shape of the id; a uuid from another
   * church's register is still a uuid. The foreign key on `invited_by_id`
   * points at `member.id` globally, so without this a staff member could
   * write a cross-tenant reference — and the joins that read it back would
   * then print another church's member name on this church's page and in its
   * CSV export. Dropped rather than refused, falling back to the typed name,
   * because for every legitimate user the id came from their own datalist and
   * a mismatch means a bug or an attack, not a correction worth stopping for.
   */
  let invitedById = d.invitedById;
  let invitedByName = d.invitedByName;
  if (invitedById) {
    const [inv] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.id, invitedById), eq(member.churchId, opts.churchId)))
      .limit(1);
    if (!inv) {
      invitedById = null;
      invitedByName = d.invitedByName ?? null;
    }
  }

  const phoneNorm = d.phone ? normalizePhone(d.phone) : null;
  const emailNorm = d.email ? d.email.toLowerCase() : null;

  const existing = await findExistingMember(opts.churchId, emailNorm, phoneNorm);

  if (existing) {
    const [current] = await db
      .select({
        firstVisitDate: member.firstVisitDate,
        inFollowUp: member.inFollowUp,
        followUpStatus: member.followUpStatus,
        gender: member.gender,
        email: member.email,
        phone: member.phone,
        address: member.address,
        city: member.city,
        state: member.state,
        invitedById: member.invitedById,
        invitedByName: member.invitedByName,
        notes: member.notes,
      })
      .from(member)
      .where(eq(member.id, existing.id))
      .limit(1);

    const patch: Partial<typeof member.$inferInsert> = {};

    /*
     * Everything in this block is personal data belonging to somebody already
     * on the register, so none of it happens on the public path. See
     * `allowPatchExisting`.
     *
     * `??=` in spirit: only ever writes where there is nothing already.
     */
    if (allowPatch) {
      if (!current?.firstVisitDate) patch.firstVisitDate = d.firstVisitDate;
      if (!current?.gender && d.gender) patch.gender = d.gender;
      if (!current?.email && d.email) patch.email = d.email;
      if (!current?.phone && d.phone) patch.phone = d.phone;
      if (!current?.address && d.address) patch.address = d.address;
      if (!current?.city && d.city) patch.city = d.city;
      if (!current?.state && d.state) patch.state = d.state;
      if (!current?.invitedById && !current?.invitedByName) {
        if (invitedById) patch.invitedById = invitedById;
        if (invitedByName) patch.invitedByName = invitedByName;
      }
      if (!current?.notes && d.notes) patch.notes = d.notes;
    }

    const alreadyInFollowUp = current?.inFollowUp === true;
    if (!alreadyInFollowUp) {
      patch.inFollowUp = true;
      if (!current?.followUpStatus) patch.followUpStatus = "new";
    }

    if (Object.keys(patch).length > 0) {
      await db.update(member).set(patch).where(eq(member.id, existing.id));
    }

    return {
      ok: true,
      result: { outcome: "matched", memberId: existing.id, alreadyInFollowUp },
    };
  }

  const [created] = await db
    .insert(member)
    .values({
      churchId: opts.churchId,
      firstName: d.firstName,
      lastName: d.lastName,
      gender: d.gender,
      phone: d.phone,
      email: d.email,
      address: d.address,
      city: d.city,
      state: d.state,
      notes: d.notes,
      firstVisitDate: d.firstVisitDate,
      invitedById,
      invitedByName,
      /*
       * The three fields this whole module exists to get right, and none of
       * them is a question anybody is asked.
       *
       * `joinedAt` is deliberately NOT set: it means the day somebody became
       * a member, and a first-timer has not.
       */
      status: "visitor",
      inFollowUp: true,
      followUpStatus: "new",
      createdBy: opts.createdBy ?? null,
    })
    .returning({ id: member.id });

  return { ok: true, result: { outcome: "created", memberId: created.id } };
}

/** Recent first-timers, newest visit first, for the module's own page. */
export async function listFirstTimers(churchId: string, limit = 200) {
  /*
   * The inviter is read through an ALIASED SELF-JOIN, not a correlated
   * subquery in a raw `sql` template. That shape is the trap in AGENTS.md:
   * drizzle drops the table qualifier inside a raw template, so
   *
   *     sql`(select ... from ${member} i where i.id = ${member.invitedById})`
   *
   * renders as `where i.id = "invited_by_id"`, Postgres binds BOTH names to
   * the inner table, and every inviter comes back null for ever with no
   * error. `sql-safety.test.ts` fails the build on it. A join is qualified
   * properly and reads better anyway.
   */
  const inviter = alias(member, "inviter");

  return db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      phone: member.phone,
      email: member.email,
      gender: member.gender,
      status: member.status,
      firstVisitDate: member.firstVisitDate,
      invitedByName: member.invitedByName,
      invitedById: member.invitedById,
      inFollowUp: member.inFollowUp,
      followUpStatus: member.followUpStatus,
      createdAt: member.createdAt,
      inviterFirstName: inviter.firstName,
      inviterLastName: inviter.lastName,
    })
    .from(member)
    /*
     * Scoped to the same church, not just matched on id.
     *
     * Belt and braces with the check in `registerFirstTimer`: a row written
     * before that check existed, or by some future path that forgets it,
     * still cannot surface another church's member name on this page.
     */
    .leftJoin(
      inviter,
      and(
        eq(inviter.id, member.invitedById),
        eq(inviter.churchId, member.churchId),
      ),
    )
    .where(
      and(
        eq(member.churchId, churchId),
        // Everyone who came in through this door, plus anyone already marked a
        // visitor before it existed — so the page is not empty on day one.
        or(isNotNull(member.firstVisitDate), eq(member.status, "visitor")),
      ),
    )
    .orderBy(
      sql`${member.firstVisitDate} desc nulls last`,
      desc(member.createdAt),
    )
    .limit(limit);
}
