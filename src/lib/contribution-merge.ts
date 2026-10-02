import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  contribution,
  contributionContributor,
  contributionEntry,
  member,
} from "@/db/schema";
import {
  bestReason,
  emailKey,
  matchReasons,
  nameKey,
  phoneKey,
  splitName,
  type MatchReason,
} from "@/lib/contributions-shared";

/**
 * Catching the register up with the names a leader typed into a phone.
 *
 * The premise of this whole module is that a collection starts before the
 * paperwork does. A choir leader on a Sunday knows twenty names and almost no
 * email addresses, so contributors are stored as names and matched to member
 * records afterwards — whenever the register catches up, which may be weeks.
 *
 * Two rules govern everything here.
 *
 * **Nothing merges itself.** Every link is proposed and confirmed by a person.
 * A wrong merge moves one member's payments onto another member's record, and
 * in a module about money that is the only genuinely destructive thing on offer.
 * An exact email is near-certain and still asks.
 *
 * **One decision covers every pot.** The same woman appears in the choir levy,
 * the harvest collection and last year's gift. Asking three times is how a
 * suggestion screen gets abandoned, so unlinked people are grouped by identity
 * and linked everywhere at once.
 *
 * The matching rules themselves are pure and tested — see
 * `matchReasons` in lib/contributions-shared.ts. This file is the plumbing.
 */

export type MatchCandidate = {
  memberId: string;
  name: string;
  phone: string | null;
  email: string | null;
  reasons: MatchReason[];
  best: MatchReason;
};

export type UnmatchedPerson = {
  /** Identity key — the thing that makes this one person across several pots. */
  key: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Every contributor row this one decision would link. */
  contributorIds: string[];
  pots: { id: string; title: string }[];
  /** Confirmed money this person has given, across every pot. */
  totalPaid: number;
  entryCount: number;
  candidates: MatchCandidate[];
};

/**
 * How many unlinked people to consider in one pass.
 *
 * A ceiling rather than pagination: the screen is a to-do list that gets
 * shorter, and a church arriving with four hundred unmatched names needs to
 * start somewhere, not to page through them. The count beside the heading comes
 * from `unlinkedContributorCount`, so the real size is never hidden.
 */
const SCAN_LIMIT = 400;

/** The identity a contributor is grouped by, strongest available first. */
function identityKey(c: {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}): string {
  const email = emailKey(c.email);
  if (email) return `e:${email}`;
  const phone = phoneKey(c.phone);
  if (phone) return `p:${phone}`;
  const name = nameKey(c.name);
  if (name) return `n:${name}`;
  // Nothing to group on. Its own key, so it is still offered rather than
  // silently dropped off the screen.
  return `c:${c.id}`;
}

/**
 * Everybody in this church's contributions who is not yet a member record,
 * with the members they might be.
 */
export async function unmatchedPeople(churchId: string): Promise<UnmatchedPerson[]> {
  const rows = await db
    .select({
      id: contributionContributor.id,
      contributionId: contributionContributor.contributionId,
      potTitle: contribution.title,
      name: contributionContributor.name,
      phone: contributionContributor.phone,
      email: contributionContributor.email,
    })
    .from(contributionContributor)
    .innerJoin(
      contribution,
      eq(contribution.id, contributionContributor.contributionId),
    )
    .where(
      and(
        eq(contributionContributor.churchId, churchId),
        isNull(contributionContributor.memberId),
        eq(contributionContributor.matchDismissed, false),
      ),
    )
    .limit(SCAN_LIMIT);

  if (rows.length === 0) return [];

  // Confirmed money per contributor, so the screen can lead with the people
  // whose records matter most.
  const paidRows = await db
    .select({
      contributorId: contributionEntry.contributorId,
      total: sql<string>`sum(${contributionEntry.amount})`,
      n: sql<string>`count(*)`,
    })
    .from(contributionEntry)
    .where(
      and(
        inArray(
          contributionEntry.contributorId,
          rows.map((r) => r.id),
        ),
        eq(contributionEntry.status, "confirmed"),
      ),
    )
    .groupBy(contributionEntry.contributorId);
  const paidBy = new Map(
    paidRows.map((r) => [
      r.contributorId,
      { total: Number(r.total) || 0, n: Number(r.n) || 0 },
    ]),
  );

  /*
   * The whole register, once.
   *
   * Four columns per member, so even a large church is a small result, and it
   * is read a single time for up to four hundred comparisons. The alternative —
   * a query per contributor — is four hundred round trips to answer one screen.
   */
  const members = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      phone: member.phone,
      email: member.email,
    })
    .from(member)
    .where(eq(member.churchId, churchId));

  // Indexed by the three things that identify somebody, so each contributor is
  // three map lookups rather than a scan of the register.
  const byEmail = new Map<string, typeof members>();
  const byPhone = new Map<string, typeof members>();
  const byName = new Map<string, typeof members>();
  for (const m of members) {
    const e = emailKey(m.email);
    if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), m]);
    const p = phoneKey(m.phone);
    if (p) byPhone.set(p, [...(byPhone.get(p) ?? []), m]);
    const n = nameKey([m.firstName, m.lastName].filter(Boolean).join(" "));
    if (n) byName.set(n, [...(byName.get(n) ?? []), m]);
  }

  // Group the contributor rows into people.
  const grouped = new Map<string, UnmatchedPerson>();
  for (const r of rows) {
    const key = identityKey(r);
    const paid = paidBy.get(r.id) ?? { total: 0, n: 0 };
    const existing = grouped.get(key);
    if (existing) {
      existing.contributorIds.push(r.id);
      if (!existing.pots.some((p) => p.id === r.contributionId))
        existing.pots.push({ id: r.contributionId, title: r.potTitle });
      existing.totalPaid += paid.total;
      existing.entryCount += paid.n;
      // Keep whichever details we have: one pot may hold a phone number the
      // other did not, and the merged person should offer both.
      existing.phone ??= r.phone;
      existing.email ??= r.email;
      continue;
    }
    grouped.set(key, {
      key,
      name: r.name,
      phone: r.phone,
      email: r.email,
      contributorIds: [r.id],
      pots: [{ id: r.contributionId, title: r.potTitle }],
      totalPaid: paid.total,
      entryCount: paid.n,
      candidates: [],
    });
  }

  // Now find each person's candidates.
  for (const person of grouped.values()) {
    const pool = new Map<string, (typeof members)[number]>();
    const e = emailKey(person.email);
    if (e) for (const m of byEmail.get(e) ?? []) pool.set(m.id, m);
    const p = phoneKey(person.phone);
    if (p) for (const m of byPhone.get(p) ?? []) pool.set(m.id, m);
    const n = nameKey(person.name);
    if (n) for (const m of byName.get(n) ?? []) pool.set(m.id, m);

    const candidates: MatchCandidate[] = [];
    for (const m of pool.values()) {
      const reasons = matchReasons(person, m);
      const best = bestReason(reasons);
      // An index hit with no reason behind it means the key matched on
      // something matchReasons refuses to accept — a one-word name, say. Not a
      // candidate.
      if (!best) continue;
      candidates.push({
        memberId: m.id,
        name: [m.firstName, m.lastName].filter(Boolean).join(" "),
        phone: m.phone,
        email: m.email,
        reasons,
        best,
      });
    }
    // Strongest evidence first, then the biggest giver — the order somebody
    // working down the list wants.
    candidates.sort((a, b) => {
      const byConfidence = confidenceOf(b) - confidenceOf(a);
      return byConfidence !== 0 ? byConfidence : a.name.localeCompare(b.name);
    });
    person.candidates = candidates;
  }

  // People with a confident suggestion first, then by money, then by name:
  // the rows where one tap is clearly right should be the rows at the top.
  return [...grouped.values()].sort((a, b) => {
    const aBest = a.candidates[0] ? confidenceOf(a.candidates[0]) : 0;
    const bBest = b.candidates[0] ? confidenceOf(b.candidates[0]) : 0;
    if (aBest !== bBest) return bBest - aBest;
    if (a.totalPaid !== b.totalPaid) return b.totalPaid - a.totalPaid;
    return a.name.localeCompare(b.name);
  });
}

/** Confidence of a candidate's strongest reason. */
function confidenceOf(c: MatchCandidate): number {
  return c.best === "email" ? 3 : c.best === "phone" ? 2 : 1;
}

/* ============================================================
 * Acting on a match
 * ========================================================== */

export type LinkResult = {
  /** Contributor rows that now point at the member. */
  linked: number;
  /**
   * Rows that were FOLDED INTO an existing contributor because that pot already
   * had the member on its roster. Their payments moved across; the empty
   * duplicate was removed.
   */
  folded: number;
  pots: number;
};

/**
 * Point a set of contributor rows at one member.
 *
 * The interesting case is a pot that already has that member on its roster —
 * "Grace Udo" typed in by hand in week one, and the real member added properly
 * in week three. Linking the typed row would break the one-member-per-pot
 * index, and refusing would leave the leader with two Graces and no way to join
 * them. So the payments move onto the existing roster row and the duplicate
 * goes: one person, one line, every payment intact.
 *
 * All of it in one transaction, because a half-finished merge is a pot whose
 * total no longer matches its entries.
 */
export async function linkContributorsToMember(opts: {
  churchId: string;
  contributorIds: string[];
  memberId: string;
}): Promise<LinkResult> {
  if (opts.contributorIds.length === 0) return { linked: 0, folded: 0, pots: 0 };

  return db.transaction(async (tx) => {
    // Scope every id to this church before touching anything. The ids arrive
    // from a form, and a tenant boundary enforced by the caller is a tenant
    // boundary enforced nowhere.
    const rows = await tx
      .select({
        id: contributionContributor.id,
        contributionId: contributionContributor.contributionId,
      })
      .from(contributionContributor)
      .where(
        and(
          eq(contributionContributor.churchId, opts.churchId),
          inArray(contributionContributor.id, opts.contributorIds),
          isNull(contributionContributor.memberId),
        ),
      );
    if (rows.length === 0) return { linked: 0, folded: 0, pots: 0 };

    const [theMember] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.id, opts.memberId), eq(member.churchId, opts.churchId)))
      .limit(1);
    if (!theMember) return { linked: 0, folded: 0, pots: 0 };

    // Which of these pots already hold this member?
    const potIds = [...new Set(rows.map((r) => r.contributionId))];
    const existing = await tx
      .select({
        id: contributionContributor.id,
        contributionId: contributionContributor.contributionId,
      })
      .from(contributionContributor)
      .where(
        and(
          inArray(contributionContributor.contributionId, potIds),
          eq(contributionContributor.memberId, opts.memberId),
        ),
      );
    const alreadyInPot = new Map(existing.map((e) => [e.contributionId, e.id]));

    let linked = 0;
    let folded = 0;

    for (const row of rows) {
      const keeper = alreadyInPot.get(row.contributionId);

      if (keeper && keeper !== row.id) {
        // Move the money, then remove the duplicate name.
        await tx
          .update(contributionEntry)
          .set({ contributorId: keeper })
          .where(eq(contributionEntry.contributorId, row.id));
        await tx
          .delete(contributionContributor)
          .where(eq(contributionContributor.id, row.id));
        folded++;
        continue;
      }

      await tx
        .update(contributionContributor)
        .set({ memberId: opts.memberId, matchDismissed: false })
        .where(eq(contributionContributor.id, row.id));
      // Claim the pot, so two typed-in duplicates inside one pot fold into the
      // first one rather than both trying to take the member.
      alreadyInPot.set(row.contributionId, row.id);
      linked++;
    }

    return { linked, folded, pots: potIds.length };
  });
}

/**
 * Add somebody to the register from what the pot already knows about them, and
 * link every row to the new record.
 *
 * Status `active` rather than `visitor`: a person paying a departmental levy is
 * part of the church by any reasonable reading, and landing them in the
 * visitor-follow-up queue would be both wrong and irritating.
 */
export async function createMemberFromContributor(opts: {
  churchId: string;
  contributorIds: string[];
  /** Overrides, when somebody tidied the name before adding them. */
  firstName?: string;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  createdBy?: string | null;
}): Promise<{ memberId: string; linked: LinkResult } | null> {
  const [source] = await db
    .select({
      id: contributionContributor.id,
      name: contributionContributor.name,
      phone: contributionContributor.phone,
      email: contributionContributor.email,
    })
    .from(contributionContributor)
    .where(
      and(
        eq(contributionContributor.churchId, opts.churchId),
        inArray(contributionContributor.id, opts.contributorIds),
      ),
    )
    .limit(1);
  if (!source) return null;

  /*
   * An edited name is taken as given; an unedited one is split.
   *
   * The difference matters: somebody who typed "Mary Ann" into the first-name
   * field meant it, and splitting it would file her surname as "Ann".
   */
  const split = splitName(source.name);
  const firstName = (opts.firstName?.trim() || split.firstName || source.name).trim();
  const lastName =
    opts.lastName !== undefined ? opts.lastName : (split.lastName ?? null);

  const [created] = await db
    .insert(member)
    .values({
      churchId: opts.churchId,
      firstName: firstName.slice(0, 120),
      lastName: lastName ? lastName.slice(0, 120) : null,
      phone: (opts.phone !== undefined ? opts.phone : source.phone) || null,
      email: (opts.email !== undefined ? opts.email : source.email) || null,
      status: "active",
      createdBy: opts.createdBy ?? undefined,
    })
    .returning({ id: member.id });
  if (!created) return null;

  const linked = await linkContributorsToMember({
    churchId: opts.churchId,
    contributorIds: opts.contributorIds,
    memberId: created.id,
  });
  return { memberId: created.id, linked };
}

/**
 * "These are different people."
 *
 * Remembered against the contributor rows, so the same wrong guess is not
 * offered next week. It is the single reason a suggestion screen stops being
 * opened: a list that will not shrink is a list nobody works.
 */
export async function dismissMatches(opts: {
  churchId: string;
  contributorIds: string[];
}): Promise<number> {
  if (opts.contributorIds.length === 0) return 0;
  const rows = await db
    .update(contributionContributor)
    .set({ matchDismissed: true })
    .where(
      and(
        eq(contributionContributor.churchId, opts.churchId),
        inArray(contributionContributor.id, opts.contributorIds),
        isNull(contributionContributor.memberId),
      ),
    )
    .returning({ id: contributionContributor.id });
  return rows.length;
}

/** Undo a dismissal, so a mis-tap is recoverable. */
export async function restoreMatches(opts: {
  churchId: string;
  contributorIds: string[];
}): Promise<number> {
  if (opts.contributorIds.length === 0) return 0;
  const rows = await db
    .update(contributionContributor)
    .set({ matchDismissed: false })
    .where(
      and(
        eq(contributionContributor.churchId, opts.churchId),
        inArray(contributionContributor.id, opts.contributorIds),
      ),
    )
    .returning({ id: contributionContributor.id });
  return rows.length;
}

/** People set aside as "not a match", so the decision can be reviewed. */
export async function dismissedPeople(churchId: string): Promise<
  { id: string; name: string; potTitle: string; potId: string }[]
> {
  return db
    .select({
      id: contributionContributor.id,
      name: contributionContributor.name,
      potTitle: contribution.title,
      potId: contribution.id,
    })
    .from(contributionContributor)
    .innerJoin(
      contribution,
      eq(contribution.id, contributionContributor.contributionId),
    )
    .where(
      and(
        eq(contributionContributor.churchId, churchId),
        isNull(contributionContributor.memberId),
        eq(contributionContributor.matchDismissed, true),
      ),
    )
    .limit(200);
}

/**
 * Candidates for one contributor, for the inline "is this them?" prompt shown
 * the moment a name is typed into a pot.
 *
 * Catching a duplicate at the keyboard is worth ten merge screens later, and it
 * is also the moment the person entering it actually knows the answer.
 */
export async function candidatesForNewName(opts: {
  churchId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  limit?: number;
}): Promise<MatchCandidate[]> {
  const e = emailKey(opts.email);
  const p = phoneKey(opts.phone);
  const n = nameKey(opts.name);
  if (!e && !p && !n) return [];

  const members = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      phone: member.phone,
      email: member.email,
    })
    .from(member)
    .where(eq(member.churchId, opts.churchId));

  const out: MatchCandidate[] = [];
  for (const m of members) {
    const list = matchReasons(
      { name: opts.name, phone: opts.phone, email: opts.email },
      m,
    );
    const best = bestReason(list);
    if (!best) continue;
    out.push({
      memberId: m.id,
      name: [m.firstName, m.lastName].filter(Boolean).join(" "),
      phone: m.phone,
      email: m.email,
      reasons: list,
      best,
    });
  }
  out.sort((a, b) => confidenceOf(b) - confidenceOf(a));
  return out.slice(0, opts.limit ?? 5);
}
