import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  contribution,
  contributionApproval,
  contributionManager,
  contributionContributor,
  contributionEntry,
  contributionPayout,
  group,
  groupMembership,
  media,
  member,
  staff,
  user,
} from "@/db/schema";
import { randomSuffix, slugify } from "@/lib/slug";
import {
  effectiveTarget,
  expectedFor,
  potTotals,
  summarisePerson,
  type ApprovalDecision,
  type ContributionKind,
  type ContributionStatus,
  type ContributionVisibility,
  type EntryStatus,
  type EntrySource,
  type PayoutKind,
  type PayoutStatus,
} from "@/lib/contributions-shared";

/**
 * Reading contributions.
 *
 * Every total here is a SUM of rows, and every aggregate is a GROUPED query
 * joined back in JavaScript rather than a correlated subquery. That is not a
 * style preference: a raw `sql` template in a query with no join loses its
 * table qualifier, Postgres binds both sides of `where "contribution_id" = "id"`
 * to the inner table, and the count comes back as a silent zero (see AGENTS.md,
 * and src/lib/sql-safety.test.ts, which fails the build on the shape). A
 * transparency page that quietly reads zero is the worst bug this module could
 * ship, so the shape is avoided entirely.
 */

/* ============================================================
 * Slugs
 * ========================================================== */

/**
 * A stable public slug. Minted once and never changed, because it goes into a
 * WhatsApp message that people scroll back to weeks later.
 */
export async function uniqueContributionSlug(title: string): Promise<string> {
  const base = slugify(title) || "contribution";
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = attempt === 0 ? `${base}-${randomSuffix(5)}` : `${base}-${randomSuffix(7)}`;
    const [clash] = await db
      .select({ id: contribution.id })
      .from(contribution)
      .where(eq(contribution.slug, candidate))
      .limit(1);
    if (!clash) return candidate;
  }
  // Six collisions on a random five-character suffix means something is wrong
  // with the generator, not with luck. A timestamp is ugly and certain.
  return `${base}-${Date.now().toString(36)}`;
}

/* ============================================================
 * Who may manage a pot
 * ========================================================== */

/**
 * Can this person run this pot?
 *
 * The permission alone is not enough, and this is the design decision that
 * makes the feature usable at all. The people who actually run a choir levy are
 * the choir's leaders — and a choir leader is almost never a church
 * administrator. If managing a pot required `contributions.manage`, every
 * collection in the church would have to be run by the two people with admin
 * rights, which is exactly the bottleneck the paper notebook does not have.
 *
 * So three routes in: the module permission, having created the pot, or leading
 * the group it belongs to. The last one is resolved through the signed-in user's
 * own member record, so it follows them when leadership changes hands.
 */
export async function canManageContribution(opts: {
  churchId: string;
  userId: string;
  potId: string;
  /** True when the caller already holds `contributions.manage` (or is owner). */
  hasModulePermission: boolean;
}): Promise<boolean> {
  if (opts.hasModulePermission) return true;

  const [row] = await db
    .select({ createdBy: contribution.createdBy, groupId: contribution.groupId })
    .from(contribution)
    .where(
      and(eq(contribution.id, opts.potId), eq(contribution.churchId, opts.churchId)),
    )
    .limit(1);
  if (!row) return false;

  // Named on the collection, as its owner or a co-admin.
  const [manager] = await db
    .select({ role: contributionManager.role })
    .from(contributionManager)
    .where(
      and(
        eq(contributionManager.contributionId, opts.potId),
        eq(contributionManager.userId, opts.userId),
      ),
    )
    .limit(1);
  if (manager) return true;

  /*
   * The creator, still — for collections that predate the owner table and for
   * any whose owner row was lost with a deleted account. Dropping this would
   * silently lock somebody out of their own live collection on the day this
   * shipped, which is the sort of upgrade nobody forgives.
   */
  if (row.createdBy && row.createdBy === opts.userId) return true;
  if (!row.groupId) return false;

  const [lead] = await db
    .select({ id: groupMembership.id })
    .from(groupMembership)
    .innerJoin(member, eq(member.id, groupMembership.memberId))
    .where(
      and(
        eq(groupMembership.groupId, row.groupId),
        eq(groupMembership.isLeader, true),
        eq(member.churchId, opts.churchId),
        eq(member.userId, opts.userId),
      ),
    )
    .limit(1);
  return !!lead;
}

/** The groups this person leads — the pots they can start without admin rights. */
export async function groupsLedBy(
  churchId: string,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ groupId: groupMembership.groupId })
    .from(groupMembership)
    .innerJoin(member, eq(member.id, groupMembership.memberId))
    .where(
      and(
        eq(groupMembership.isLeader, true),
        eq(member.churchId, churchId),
        eq(member.userId, userId),
      ),
    );
  return rows.map((r) => r.groupId);
}

/* ============================================================
 * Who runs a collection
 * ========================================================== */

export type ManagerRow = {
  userId: string;
  name: string;
  email: string;
  role: "owner" | "coadmin";
  addedAt: string;
};

/** The owner and co-admins of one collection, owner first. */
export async function listManagers(potId: string): Promise<ManagerRow[]> {
  const rows = await db
    .select({
      userId: contributionManager.userId,
      role: contributionManager.role,
      createdAt: contributionManager.createdAt,
      name: user.name,
      email: user.email,
    })
    .from(contributionManager)
    .innerJoin(user, eq(user.id, contributionManager.userId))
    .where(eq(contributionManager.contributionId, potId))
    .orderBy(asc(contributionManager.createdAt));

  return rows
    .map((r) => ({
      userId: r.userId,
      name: r.name,
      email: r.email,
      role: r.role as "owner" | "coadmin",
      addedAt: r.createdAt.toISOString(),
    }))
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "owner" ? -1 : 1));
}

/**
 * Changing who runs a collection is the owner's decision, or an administrator's.
 *
 * Deliberately NOT something a co-admin can do. A co-admin records and confirms
 * money; letting them appoint further co-admins, or remove the owner who
 * appointed them, would mean anybody admitted to the collection could widen
 * their own access — which makes the whole arrangement decorative.
 */
export async function canManageManagers(opts: {
  churchId: string;
  userId: string;
  potId: string;
  hasModulePermission: boolean;
}): Promise<boolean> {
  if (opts.hasModulePermission) return true;
  const [row] = await db
    .select({ role: contributionManager.role })
    .from(contributionManager)
    .where(
      and(
        eq(contributionManager.contributionId, opts.potId),
        eq(contributionManager.userId, opts.userId),
      ),
    )
    .limit(1);
  if (row?.role === "owner") return true;

  // A collection with no owner row at all (created before this existed, or its
  // owner's account was deleted) falls back to whoever started it, so it can
  // always be rescued by somebody rather than becoming unadministrable.
  const [pot] = await db
    .select({ createdBy: contribution.createdBy })
    .from(contribution)
    .where(
      and(eq(contribution.id, opts.potId), eq(contribution.churchId, opts.churchId)),
    )
    .limit(1);
  if (!pot?.createdBy || pot.createdBy !== opts.userId) return false;
  const [anyOwner] = await db
    .select({ id: contributionManager.id })
    .from(contributionManager)
    .where(
      and(
        eq(contributionManager.contributionId, opts.potId),
        eq(contributionManager.role, "owner"),
      ),
    )
    .limit(1);
  return !anyOwner;
}

/**
 * The people who could be given a collection to run: this church's team.
 *
 * Staff accounts, not members — somebody who cannot sign in cannot administer
 * anything, and offering their name would promise something that does not work.
 * Temporary memberships (created while a platform admin is acting as the
 * church) are excluded, so a support visit never appears as a candidate owner.
 */
export async function staffCandidates(
  churchId: string,
): Promise<{ userId: string; name: string; email: string; role: string }[]> {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: staff.role,
    })
    .from(staff)
    .innerJoin(user, eq(user.id, staff.userId))
    .where(and(eq(staff.organizationId, churchId), eq(staff.temp, false)))
    .orderBy(asc(user.name));
  return rows;
}

/* ============================================================
 * The list
 * ========================================================== */

export type ContributionListRow = {
  id: string;
  title: string;
  slug: string;
  purpose: string | null;
  kind: ContributionKind;
  status: ContributionStatus;
  visibility: ContributionVisibility;
  groupId: string | null;
  groupName: string | null;
  honoureeName: string | null;
  targetAmount: number | null;
  perPersonAmount: number | null;
  dueDate: string | null;
  /** Confirmed money in. */
  raised: number;
  /** Claimed, not yet confirmed. Called out separately, never added in. */
  pending: number;
  disputed: number;
  paidOut: number;
  balance: number;
  /** People on the roster. */
  people: number;
  /** People with at least one confirmed payment. */
  givers: number;
  /** The goal to show, typed or inferred from the roster. */
  target: number | null;
  /** Entries waiting on somebody — the number the list badges. */
  awaiting: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Every pot in a church, with its figures.
 *
 * Five grouped queries rather than one query with five subselects. More round
 * trips, no correlated-subquery trap, and each one is a plain index scan.
 */
export async function listContributions(
  churchId: string,
  opts: { groupIds?: string[] } = {},
): Promise<ContributionListRow[]> {
  const where =
    opts.groupIds && opts.groupIds.length > 0
      ? and(
          eq(contribution.churchId, churchId),
          inArray(contribution.groupId, opts.groupIds),
        )
      : eq(contribution.churchId, churchId);

  const pots = await db
    .select({
      id: contribution.id,
      title: contribution.title,
      slug: contribution.slug,
      purpose: contribution.purpose,
      kind: contribution.kind,
      status: contribution.status,
      visibility: contribution.visibility,
      groupId: contribution.groupId,
      groupName: group.name,
      honoureeName: contribution.honoureeName,
      targetAmount: contribution.targetAmount,
      perPersonAmount: contribution.perPersonAmount,
      dueDate: contribution.dueDate,
      createdAt: contribution.createdAt,
      updatedAt: contribution.updatedAt,
    })
    .from(contribution)
    .leftJoin(group, eq(group.id, contribution.groupId))
    .where(where)
    .orderBy(desc(contribution.createdAt));

  if (pots.length === 0) return [];
  const ids = pots.map((p) => p.id);

  const [entryRows, payoutRows, rosterRows, giverRows] = await Promise.all([
    // Money in, by pot and status.
    db
      .select({
        potId: contributionEntry.contributionId,
        status: contributionEntry.status,
        total: sql<string>`sum(${contributionEntry.amount})`,
        n: sql<string>`count(*)`,
      })
      .from(contributionEntry)
      .where(inArray(contributionEntry.contributionId, ids))
      .groupBy(contributionEntry.contributionId, contributionEntry.status),
    // Money out, by pot and status.
    db
      .select({
        potId: contributionPayout.contributionId,
        status: contributionPayout.status,
        total: sql<string>`sum(${contributionPayout.amount})`,
      })
      .from(contributionPayout)
      .where(inArray(contributionPayout.contributionId, ids))
      .groupBy(contributionPayout.contributionId, contributionPayout.status),
    /*
     * The roster, and the part of the expected total that was set per person.
     *
     * `withExpected` is counted so the rest of the roster can be multiplied by
     * the pot's own per-person figure in JS. Doing that in SQL would need the
     * pot's value inside the aggregate — which is the correlated subquery this
     * module refuses to write.
     */
    db
      .select({
        potId: contributionContributor.contributionId,
        people: sql<string>`count(*)`,
        expectedSet: sql<string>`coalesce(sum(${contributionContributor.expectedAmount}), 0)`,
        withExpected: sql<string>`count(${contributionContributor.expectedAmount})`,
      })
      .from(contributionContributor)
      .where(inArray(contributionContributor.contributionId, ids))
      .groupBy(contributionContributor.contributionId),
    // Distinct people with at least one confirmed payment.
    db
      .select({
        potId: contributionEntry.contributionId,
        givers: sql<string>`count(distinct ${contributionEntry.contributorId})`,
      })
      .from(contributionEntry)
      .where(
        and(
          inArray(contributionEntry.contributionId, ids),
          eq(contributionEntry.status, "confirmed"),
        ),
      )
      .groupBy(contributionEntry.contributionId),
  ]);

  const byPot = new Map<
    string,
    { raised: number; pending: number; disputed: number; awaiting: number }
  >();
  for (const r of entryRows) {
    const bucket =
      byPot.get(r.potId) ?? { raised: 0, pending: 0, disputed: 0, awaiting: 0 };
    const total = Number(r.total) || 0;
    const n = Number(r.n) || 0;
    if (r.status === "confirmed") bucket.raised += total;
    else if (r.status === "pending") {
      bucket.pending += total;
      bucket.awaiting += n;
    } else if (r.status === "disputed") {
      bucket.disputed += total;
      bucket.awaiting += n;
    }
    byPot.set(r.potId, bucket);
  }

  const outByPot = new Map<string, { paidOut: number; pendingOut: number }>();
  for (const r of payoutRows) {
    const bucket = outByPot.get(r.potId) ?? { paidOut: 0, pendingOut: 0 };
    const total = Number(r.total) || 0;
    if (r.status === "approved") bucket.paidOut += total;
    else if (r.status === "pending") bucket.pendingOut += total;
    outByPot.set(r.potId, bucket);
  }

  const rosterByPot = new Map(
    rosterRows.map((r) => [
      r.potId,
      {
        people: Number(r.people) || 0,
        expectedSet: Number(r.expectedSet) || 0,
        withExpected: Number(r.withExpected) || 0,
      },
    ]),
  );
  const giversByPot = new Map(giverRows.map((r) => [r.potId, Number(r.givers) || 0]));

  return pots.map((p) => {
    const money = byPot.get(p.id) ?? {
      raised: 0,
      pending: 0,
      disputed: 0,
      awaiting: 0,
    };
    const out = outByPot.get(p.id) ?? { paidOut: 0, pendingOut: 0 };
    const roster = rosterByPot.get(p.id) ?? {
      people: 0,
      expectedSet: 0,
      withExpected: 0,
    };
    const unset = Math.max(0, roster.people - roster.withExpected);
    const expectedTotal = roster.expectedSet + unset * (p.perPersonAmount ?? 0);

    return {
      ...p,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      raised: money.raised,
      pending: money.pending,
      disputed: money.disputed,
      awaiting: money.awaiting,
      paidOut: out.paidOut,
      balance: money.raised - out.paidOut,
      people: roster.people,
      givers: giversByPot.get(p.id) ?? 0,
      target: effectiveTarget({
        targetAmount: p.targetAmount,
        perPersonAmount: p.perPersonAmount,
        expectedTotal,
      }),
    };
  });
}

/* ============================================================
 * One pot, in full
 * ========================================================== */

export type ApprovalRow = {
  id: string;
  decision: ApprovalDecision;
  actorName: string;
  userId: string | null;
  note: string | null;
  createdAt: string;
};

export type EntryRow = {
  id: string;
  contributorId: string;
  contributorName: string;
  /** The linked member, when the contributor has been matched to the register. */
  memberId: string | null;
  isAnonymous: boolean;
  amount: number;
  method: string | null;
  paidOn: string;
  reference: string | null;
  note: string | null;
  status: EntryStatus;
  source: EntrySource;
  proofUrl: string | null;
  proofMime: string | null;
  proofReleasedAt: string | null;
  confirmedAt: string | null;
  resolutionNote: string | null;
  recordedByName: string | null;
  createdAt: string;
  approvals: ApprovalRow[];
  /** Distinct people who confirmed / disputed, so the UI can say "1 of 2". */
  confirmations: number;
  disputes: number;
};

export type PayoutRow = {
  id: string;
  kind: PayoutKind;
  amount: number;
  paidOn: string;
  payee: string | null;
  purpose: string | null;
  method: string | null;
  reference: string | null;
  status: PayoutStatus;
  proofUrl: string | null;
  proofMime: string | null;
  proofReleasedAt: string | null;
  financeTransactionId: string | null;
  approvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  approvals: ApprovalRow[];
  approvalCount: number;
  objections: number;
};

export type ContributorRow = {
  id: string;
  memberId: string | null;
  /** The name as typed into the pot. */
  name: string;
  /** The register's own name, when linked — so a mismatch is visible. */
  memberName: string | null;
  phone: string | null;
  email: string | null;
  expectedAmount: number | null;
  isAnonymous: boolean;
  note: string | null;
  matchDismissed: boolean;
  /** Their figures. */
  expected: number | null;
  paid: number;
  pending: number;
  outstanding: number;
  settled: boolean;
  entryCount: number;
  lastPaidOn: string | null;
};

export type ContributionDetail = {
  id: string;
  churchId: string;
  title: string;
  slug: string;
  purpose: string | null;
  kind: ContributionKind;
  status: ContributionStatus;
  visibility: ContributionVisibility;
  groupId: string | null;
  groupName: string | null;
  honoureeMemberId: string | null;
  honoureeName: string | null;
  targetAmount: number | null;
  perPersonAmount: number | null;
  payInstructions: string | null;
  startDate: string | null;
  dueDate: string | null;
  showOutstanding: boolean;
  showPayouts: boolean;
  showNotes: boolean;
  allowSelfReport: boolean;
  askForProof: boolean;
  confirmationsRequired: number;
  payoutApprovalsRequired: number;
  keepProofs: boolean;
  closedAt: string | null;
  settledAt: string | null;
  goalReachedAt: string | null;
  createdByName: string | null;
  createdAt: string;

  /** Who runs it — owner first. */
  managers: ManagerRow[];

  contributors: ContributorRow[];
  entries: EntryRow[];
  payouts: PayoutRow[];

  /** Derived figures, computed once here so no screen recomputes them. */
  raised: number;
  pendingIn: number;
  disputedIn: number;
  paidOut: number;
  pendingOut: number;
  balance: number;
  target: number | null;
  expectedTotal: number;
  /** Bytes of receipts held against the church's storage quota. */
  proofBytes: number;
  proofCount: number;
};

export async function getContribution(
  churchId: string,
  id: string,
): Promise<ContributionDetail | null> {
  const [pot] = await db
    .select({
      row: contribution,
      groupName: group.name,
      createdByName: user.name,
    })
    .from(contribution)
    .leftJoin(group, eq(group.id, contribution.groupId))
    .leftJoin(user, eq(user.id, contribution.createdBy))
    .where(and(eq(contribution.id, id), eq(contribution.churchId, churchId)))
    .limit(1);
  if (!pot) return null;

  const p = pot.row;

  const [managers, contributors, entries, payouts] = await Promise.all([
    listManagers(id),
    db
      .select({
        row: contributionContributor,
        memberFirst: member.firstName,
        memberLast: member.lastName,
      })
      .from(contributionContributor)
      .leftJoin(member, eq(member.id, contributionContributor.memberId))
      .where(eq(contributionContributor.contributionId, id))
      .orderBy(asc(contributionContributor.name)),
    db
      .select({
        row: contributionEntry,
        contributorName: contributionContributor.name,
        contributorMemberId: contributionContributor.memberId,
        contributorAnonymous: contributionContributor.isAnonymous,
        proofUrl: media.url,
        proofMime: media.mime,
      })
      .from(contributionEntry)
      .innerJoin(
        contributionContributor,
        eq(contributionContributor.id, contributionEntry.contributorId),
      )
      .leftJoin(media, eq(media.id, contributionEntry.proofMediaId))
      .where(eq(contributionEntry.contributionId, id))
      .orderBy(desc(contributionEntry.paidOn), desc(contributionEntry.createdAt)),
    db
      .select({
        row: contributionPayout,
        proofUrl: media.url,
        proofMime: media.mime,
      })
      .from(contributionPayout)
      .leftJoin(media, eq(media.id, contributionPayout.proofMediaId))
      .where(eq(contributionPayout.contributionId, id))
      .orderBy(desc(contributionPayout.paidOn), desc(contributionPayout.createdAt)),
  ]);

  // Approvals for everything on this pot, in one query, grouped in JS.
  const entryIds = entries.map((e) => e.row.id);
  const payoutIds = payouts.map((pp) => pp.row.id);
  const approvalTargets = [
    entryIds.length > 0 ? inArray(contributionApproval.entryId, entryIds) : undefined,
    payoutIds.length > 0
      ? inArray(contributionApproval.payoutId, payoutIds)
      : undefined,
  ].filter((x) => x !== undefined);
  const approvals =
    approvalTargets.length === 0
      ? []
      : await db
          .select()
          .from(contributionApproval)
          .where(
            and(eq(contributionApproval.churchId, churchId), or(...approvalTargets)),
          )
          .orderBy(asc(contributionApproval.createdAt));

  const approvalsByEntry = new Map<string, ApprovalRow[]>();
  const approvalsByPayout = new Map<string, ApprovalRow[]>();
  for (const a of approvals) {
    const row: ApprovalRow = {
      id: a.id,
      decision: a.decision as ApprovalDecision,
      actorName: a.actorName,
      userId: a.userId,
      note: a.note,
      createdAt: a.createdAt.toISOString(),
    };
    if (a.entryId) {
      const list = approvalsByEntry.get(a.entryId) ?? [];
      list.push(row);
      approvalsByEntry.set(a.entryId, list);
    } else if (a.payoutId) {
      const list = approvalsByPayout.get(a.payoutId) ?? [];
      list.push(row);
      approvalsByPayout.set(a.payoutId, list);
    }
  }

  const entryRows: EntryRow[] = entries.map((e) => {
    const list = approvalsByEntry.get(e.row.id) ?? [];
    return {
      id: e.row.id,
      contributorId: e.row.contributorId,
      contributorName: e.contributorName,
      memberId: e.contributorMemberId,
      isAnonymous: e.contributorAnonymous,
      amount: e.row.amount,
      method: e.row.method,
      paidOn: e.row.paidOn,
      reference: e.row.reference,
      note: e.row.note,
      status: e.row.status as EntryStatus,
      source: e.row.source as EntrySource,
      proofUrl: e.proofUrl ?? null,
      proofMime: e.proofMime ?? null,
      proofReleasedAt: e.row.proofReleasedAt?.toISOString() ?? null,
      confirmedAt: e.row.confirmedAt?.toISOString() ?? null,
      resolutionNote: e.row.resolutionNote,
      recordedByName: e.row.recordedByName,
      createdAt: e.row.createdAt.toISOString(),
      approvals: list,
      confirmations: list.filter((a) => a.decision === "confirm").length,
      disputes: list.filter((a) => a.decision === "dispute").length,
    };
  });

  const payoutRows: PayoutRow[] = payouts.map((pp) => {
    const list = approvalsByPayout.get(pp.row.id) ?? [];
    return {
      id: pp.row.id,
      kind: pp.row.kind as PayoutKind,
      amount: pp.row.amount,
      paidOn: pp.row.paidOn,
      payee: pp.row.payee,
      purpose: pp.row.purpose,
      method: pp.row.method,
      reference: pp.row.reference,
      status: pp.row.status as PayoutStatus,
      proofUrl: pp.proofUrl ?? null,
      proofMime: pp.proofMime ?? null,
      proofReleasedAt: pp.row.proofReleasedAt?.toISOString() ?? null,
      financeTransactionId: pp.row.financeTransactionId,
      approvedAt: pp.row.approvedAt?.toISOString() ?? null,
      resolutionNote: pp.row.resolutionNote,
      createdAt: pp.row.createdAt.toISOString(),
      approvals: list,
      approvalCount: list.filter((a) => a.decision === "confirm").length,
      objections: list.filter((a) => a.decision === "dispute").length,
    };
  });

  // Each person's figures, from their own entries.
  const entriesByContributor = new Map<string, EntryRow[]>();
  for (const e of entryRows) {
    const list = entriesByContributor.get(e.contributorId) ?? [];
    list.push(e);
    entriesByContributor.set(e.contributorId, list);
  }

  const contributorRows: ContributorRow[] = contributors.map((c) => {
    const mine = entriesByContributor.get(c.row.id) ?? [];
    const expected = expectedFor(c.row.expectedAmount, p.perPersonAmount);
    const s = summarisePerson({ expected, entries: mine });
    const memberName = c.memberFirst
      ? [c.memberFirst, c.memberLast].filter(Boolean).join(" ")
      : null;
    return {
      id: c.row.id,
      memberId: c.row.memberId,
      name: c.row.name,
      memberName,
      phone: c.row.phone,
      email: c.row.email,
      expectedAmount: c.row.expectedAmount,
      isAnonymous: c.row.isAnonymous,
      note: c.row.note,
      matchDismissed: c.row.matchDismissed,
      expected: s.expected,
      paid: s.paid,
      pending: s.pending,
      outstanding: s.outstanding,
      settled: s.settled,
      entryCount: mine.length,
      lastPaidOn: mine.length > 0 ? mine[0].paidOn : null,
    };
  });

  const totals = potTotals(entryRows, payoutRows);
  const expectedTotal = contributorRows.reduce((a, c) => a + (c.expected ?? 0), 0);

  /*
   * What the receipts on this pot are costing.
   *
   * Shown where the cost is incurred, because a storage quota nobody can
   * attribute is a quota nobody manages — and these files are the one part of
   * this module that bills a church every month it exists.
   *
   * The media ids come from rows already in hand rather than from a subquery
   * against the entries. That is not a micro-optimisation: a correlated `sql`
   * template here would lose its table qualifier and silently report zero bytes
   * (see the note at the top of this file).
   */
  const proofIds = [
    ...entries.map((e) => e.row.proofMediaId),
    ...payouts.map((x) => x.row.proofMediaId),
  ].filter((x): x is string => x !== null);

  const proofTally =
    proofIds.length === 0
      ? { n: 0, bytes: 0 }
      : await db
          .select({
            n: sql<string>`count(*)`,
            bytes: sql<string>`coalesce(sum(${media.bytes}), 0)`,
          })
          .from(media)
          .where(and(eq(media.churchId, churchId), inArray(media.id, proofIds)))
          .then((rows) => ({
            n: Number(rows[0]?.n ?? 0),
            bytes: Number(rows[0]?.bytes ?? 0),
          }));

  return {
    id: p.id,
    churchId: p.churchId,
    title: p.title,
    slug: p.slug,
    purpose: p.purpose,
    kind: p.kind as ContributionKind,
    status: p.status as ContributionStatus,
    visibility: p.visibility as ContributionVisibility,
    groupId: p.groupId,
    groupName: pot.groupName,
    honoureeMemberId: p.honoureeMemberId,
    honoureeName: p.honoureeName,
    targetAmount: p.targetAmount,
    perPersonAmount: p.perPersonAmount,
    payInstructions: p.payInstructions,
    startDate: p.startDate,
    dueDate: p.dueDate,
    showOutstanding: p.showOutstanding,
    showPayouts: p.showPayouts,
    showNotes: p.showNotes,
    allowSelfReport: p.allowSelfReport,
    askForProof: p.askForProof,
    confirmationsRequired: p.confirmationsRequired,
    payoutApprovalsRequired: p.payoutApprovalsRequired,
    keepProofs: p.keepProofs,
    closedAt: p.closedAt?.toISOString() ?? null,
    settledAt: p.settledAt?.toISOString() ?? null,
    goalReachedAt: p.goalReachedAt?.toISOString() ?? null,
    createdByName: pot.createdByName,
    createdAt: p.createdAt.toISOString(),

    managers,

    contributors: contributorRows,
    entries: entryRows,
    payouts: payoutRows,

    raised: totals.raised,
    pendingIn: totals.pending,
    disputedIn: totals.disputed,
    paidOut: totals.paidOut,
    pendingOut: totals.pendingOut,
    balance: totals.balance,
    target: effectiveTarget({
      targetAmount: p.targetAmount,
      perPersonAmount: p.perPersonAmount,
      expectedTotal,
    }),
    expectedTotal,
    proofCount: proofTally.n,
    proofBytes: proofTally.bytes,
  };
}

/* ============================================================
 * The public projection
 * ========================================================== */

export type PublicLedgerRow = {
  id: string;
  /** "Anonymous" when the contributor asked for it. Never the real name. */
  name: string;
  amount: number | null;
  paidOn: string;
  status: EntryStatus;
  note: string | null;
  method: string | null;
  hasProof: boolean;
};

export type PublicPayoutRow = {
  id: string;
  kind: PayoutKind;
  label: string;
  amount: number;
  paidOn: string;
  payee: string | null;
  purpose: string | null;
  status: PayoutStatus;
  hasProof: boolean;
};

export type PublicContribution = {
  id: string;
  slug: string;
  title: string;
  purpose: string | null;
  kind: ContributionKind;
  status: ContributionStatus;
  visibility: Exclude<ContributionVisibility, "private">;
  groupName: string | null;
  honoureeName: string | null;
  churchName: string;
  churchLogo: string | null;
  churchHandle: string | null;
  currency: string;
  payInstructions: string | null;
  dueDate: string | null;
  allowSelfReport: boolean;
  askForProof: boolean;
  showNotes: boolean;
  showPayouts: boolean;
  showOutstanding: boolean;
  perPersonAmount: number | null;
  target: number | null;
  raised: number;
  pendingIn: number;
  paidOut: number;
  balance: number;
  /** People with at least one confirmed payment. */
  givers: number;
  /** People expected, where there is a roster. */
  people: number;
  goalReached: boolean;
  /** Only present at `detailed` visibility. */
  ledger: PublicLedgerRow[];
  /** Only present when `showOutstanding`. Names, no amounts beyond what is due. */
  stillToGive: { name: string; outstanding: number }[];
  payouts: PublicPayoutRow[];
  updatedAt: string;
};

/**
 * What the shared link shows, built from the church's own setting rather than
 * from what the page happens to render.
 *
 * Returning a narrowed object rather than the full detail is the whole point:
 * a `summary` pot must not ship names and amounts to the browser for a
 * component to decide not to draw them. Anything the viewer may not see is not
 * in the response at all.
 */
export async function getPublicContribution(
  slug: string,
): Promise<PublicContribution | null> {
  const [pot] = await db
    .select({
      row: contribution,
      groupName: group.name,
      churchName: church.name,
      churchLogo: church.logo,
      churchHandle: church.handle,
      currency: church.currency,
    })
    .from(contribution)
    .leftJoin(group, eq(group.id, contribution.groupId))
    .innerJoin(church, eq(church.id, contribution.churchId))
    .where(eq(contribution.slug, slug))
    .limit(1);
  if (!pot) return null;

  const p = pot.row;
  // A draft has never been shared, and a private pot has had its link turned
  // off. Both are "no such page" to the world, which is the honest answer.
  if (p.status === "draft" || p.visibility === "private") return null;

  const detailed = p.visibility === "detailed";

  const [moneyRows, payoutRows, giverRow] = await Promise.all([
    db
      .select({
        status: contributionEntry.status,
        total: sql<string>`sum(${contributionEntry.amount})`,
      })
      .from(contributionEntry)
      .where(eq(contributionEntry.contributionId, p.id))
      .groupBy(contributionEntry.status),
    p.showPayouts
      ? db
          .select({ row: contributionPayout })
          .from(contributionPayout)
          .where(eq(contributionPayout.contributionId, p.id))
          .orderBy(desc(contributionPayout.paidOn))
      : Promise.resolve([]),
    db
      .select({ givers: sql<string>`count(distinct ${contributionEntry.contributorId})` })
      .from(contributionEntry)
      .where(
        and(
          eq(contributionEntry.contributionId, p.id),
          eq(contributionEntry.status, "confirmed"),
        ),
      ),
  ]);

  let raised = 0;
  let pendingIn = 0;
  for (const r of moneyRows) {
    const total = Number(r.total) || 0;
    if (r.status === "confirmed") raised += total;
    else if (r.status === "pending" || r.status === "disputed") pendingIn += total;
  }

  let paidOut = 0;
  for (const r of payoutRows) {
    if (r.row.status === "approved") paidOut += r.row.amount;
  }
  // The balance must be right even when payouts are hidden, or a church that
  // turned the list off would publish a balance that ignores its own spending.
  if (!p.showPayouts) {
    const [out] = await db
      .select({ total: sql<string>`coalesce(sum(${contributionPayout.amount}), 0)` })
      .from(contributionPayout)
      .where(
        and(
          eq(contributionPayout.contributionId, p.id),
          eq(contributionPayout.status, "approved"),
        ),
      );
    paidOut = Number(out?.total ?? 0);
  }

  // The roster, needed for the goal and for "who is still to give".
  const roster = await db
    .select({
      id: contributionContributor.id,
      name: contributionContributor.name,
      isAnonymous: contributionContributor.isAnonymous,
      expectedAmount: contributionContributor.expectedAmount,
    })
    .from(contributionContributor)
    .where(eq(contributionContributor.contributionId, p.id));

  const expectedTotal = roster.reduce(
    (a, c) => a + (expectedFor(c.expectedAmount, p.perPersonAmount) ?? 0),
    0,
  );

  let ledger: PublicLedgerRow[] = [];
  let stillToGive: { name: string; outstanding: number }[] = [];

  if (detailed || p.showOutstanding) {
    const rows = await db
      .select({
        row: contributionEntry,
        contributorId: contributionContributor.id,
        contributorName: contributionContributor.name,
        isAnonymous: contributionContributor.isAnonymous,
      })
      .from(contributionEntry)
      .innerJoin(
        contributionContributor,
        eq(contributionContributor.id, contributionEntry.contributorId),
      )
      .where(eq(contributionEntry.contributionId, p.id))
      .orderBy(desc(contributionEntry.paidOn), desc(contributionEntry.createdAt));

    if (detailed) {
      ledger = rows
        // A rejected entry is not published. It is not a payment, and a public
        // line saying somebody's money "was not counted" is a grievance, not
        // transparency — the church's own screen keeps it.
        .filter((r) => r.row.status !== "rejected")
        .map((r) => ({
          id: r.row.id,
          name: r.isAnonymous ? "Anonymous" : r.contributorName,
          amount: r.row.amount,
          paidOn: r.row.paidOn,
          status: r.row.status as EntryStatus,
          note: p.showNotes ? r.row.note : null,
          method: r.row.method,
          hasProof: r.row.proofMediaId !== null,
        }));
    }

    if (p.showOutstanding) {
      const paidByContributor = new Map<string, number>();
      for (const r of rows) {
        if (r.row.status !== "confirmed") continue;
        paidByContributor.set(
          r.contributorId,
          (paidByContributor.get(r.contributorId) ?? 0) + r.row.amount,
        );
      }
      stillToGive = roster
        .map((c) => {
          const expected = expectedFor(c.expectedAmount, p.perPersonAmount);
          const paid = paidByContributor.get(c.id) ?? 0;
          return {
            name: c.isAnonymous ? "Anonymous" : c.name,
            outstanding: expected === null ? 0 : Math.max(0, expected - paid),
          };
        })
        .filter((c) => c.outstanding > 0)
        .sort((a, b) => b.outstanding - a.outstanding);
    }
  }

  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    purpose: p.purpose,
    kind: p.kind as ContributionKind,
    status: p.status as ContributionStatus,
    visibility: p.visibility as Exclude<ContributionVisibility, "private">,
    groupName: pot.groupName,
    honoureeName: p.honoureeName,
    churchName: pot.churchName,
    churchLogo: pot.churchLogo,
    churchHandle: pot.churchHandle,
    currency: pot.currency,
    payInstructions: p.payInstructions,
    dueDate: p.dueDate,
    allowSelfReport: p.allowSelfReport && p.status === "open",
    askForProof: p.askForProof,
    showNotes: p.showNotes,
    showPayouts: p.showPayouts,
    showOutstanding: p.showOutstanding,
    perPersonAmount: p.perPersonAmount,
    target: effectiveTarget({
      targetAmount: p.targetAmount,
      perPersonAmount: p.perPersonAmount,
      expectedTotal,
    }),
    raised,
    pendingIn,
    paidOut,
    balance: raised - paidOut,
    givers: Number(giverRow[0]?.givers ?? 0),
    people: roster.length,
    goalReached: !!p.goalReachedAt,
    ledger,
    stillToGive,
    payouts: p.showPayouts
      ? payoutRows.map((r) => ({
          id: r.row.id,
          kind: r.row.kind as PayoutKind,
          label: r.row.purpose || r.row.payee || "Payment",
          amount: r.row.amount,
          paidOn: r.row.paidOn,
          payee: r.row.payee,
          purpose: r.row.purpose,
          status: r.row.status as PayoutStatus,
          hasProof: r.row.proofMediaId !== null,
        }))
      : [],
    updatedAt: p.updatedAt.toISOString(),
  };
}

/* ============================================================
 * Small reads the screens need
 * ========================================================== */

/** Every member, for the "who gave?" picker. Name only — it is a dropdown. */
export async function memberOptions(
  churchId: string,
): Promise<{ id: string; name: string; phone: string | null }[]> {
  const rows = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      phone: member.phone,
    })
    .from(member)
    .where(eq(member.churchId, churchId))
    .orderBy(asc(member.firstName), asc(member.lastName));
  return rows.map((m) => ({
    id: m.id,
    name: [m.firstName, m.lastName].filter(Boolean).join(" "),
    phone: m.phone,
  }));
}

/** Active groups, for choosing whose collection this is. */
export async function groupOptions(
  churchId: string,
): Promise<{ id: string; name: string; type: string }[]> {
  return db
    .select({ id: group.id, name: group.name, type: group.type })
    .from(group)
    .where(and(eq(group.churchId, churchId), eq(group.isActive, true)))
    .orderBy(asc(group.name));
}

/**
 * How many people across the church are still unlinked to the register.
 *
 * Only a count, for the badge on the list page. The suggestions themselves are
 * resolved in lib/contribution-merge.ts, which is a heavier read nobody needs
 * until they open the screen.
 */
export async function unlinkedContributorCount(churchId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(contributionContributor)
    .where(
      and(
        eq(contributionContributor.churchId, churchId),
        isNull(contributionContributor.memberId),
        eq(contributionContributor.matchDismissed, false),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Pots a member appears in, for their profile. */
export async function contributionsForMember(
  churchId: string,
  memberId: string,
): Promise<
  { potId: string; title: string; slug: string; paid: number; outstanding: number }[]
> {
  const rows = await db
    .select({
      potId: contribution.id,
      title: contribution.title,
      slug: contribution.slug,
      perPersonAmount: contribution.perPersonAmount,
      expectedAmount: contributionContributor.expectedAmount,
      contributorId: contributionContributor.id,
    })
    .from(contributionContributor)
    .innerJoin(
      contribution,
      eq(contribution.id, contributionContributor.contributionId),
    )
    .where(
      and(
        eq(contributionContributor.churchId, churchId),
        eq(contributionContributor.memberId, memberId),
      ),
    )
    .orderBy(desc(contribution.createdAt));
  if (rows.length === 0) return [];

  const paidRows = await db
    .select({
      contributorId: contributionEntry.contributorId,
      total: sql<string>`sum(${contributionEntry.amount})`,
    })
    .from(contributionEntry)
    .where(
      and(
        inArray(
          contributionEntry.contributorId,
          rows.map((r) => r.contributorId),
        ),
        eq(contributionEntry.status, "confirmed"),
      ),
    )
    .groupBy(contributionEntry.contributorId);
  const paidBy = new Map(paidRows.map((r) => [r.contributorId, Number(r.total) || 0]));

  return rows.map((r) => {
    const paid = paidBy.get(r.contributorId) ?? 0;
    const expected = expectedFor(r.expectedAmount, r.perPersonAmount);
    return {
      potId: r.potId,
      title: r.title,
      slug: r.slug,
      paid,
      outstanding: expected === null ? 0 : Math.max(0, expected - paid),
    };
  });
}

/** Managers to notify: owners and admins, plus the leaders of the pot's group. */
export async function potNotifyLink(potId: string): Promise<string> {
  return `/contributions/${potId}`;
}

/** Pots with a deadline that have not been settled — used by the reminder cron. */
export async function potsWithDeadline(): Promise<
  {
    id: string;
    churchId: string;
    title: string;
    slug: string;
    dueDate: string | null;
    status: ContributionStatus;
  }[]
> {
  const rows = await db
    .select({
      id: contribution.id,
      churchId: contribution.churchId,
      title: contribution.title,
      slug: contribution.slug,
      dueDate: contribution.dueDate,
      status: contribution.status,
    })
    .from(contribution)
    .where(and(eq(contribution.status, "open"), isNotNull(contribution.dueDate)));
  return rows.map((r) => ({ ...r, status: r.status as ContributionStatus }));
}
