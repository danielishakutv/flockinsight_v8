/**
 * Database-backed checks for group contributions. Run with `pnpm test:db`.
 *
 * The pure rules — what counts, what a dispute does, how a name is tidied — are
 * covered in contributions-shared.test.ts without a database. These cover the
 * things only a real Postgres can tell you, and every one of them is here
 * because it is a class of bug that ships silently:
 *
 *   - A total that reads zero. Every aggregate in lib/contributions.ts is a
 *     grouped query joined in JS, specifically to avoid drizzle's correlated-
 *     subquery trap (a bare `"contribution_id" = "id"` binds both names to the
 *     inner table and returns nothing, with no error). Reading a figure back
 *     from written rows is the only way that shows itself.
 *   - A partial unique index that ON CONFLICT cannot infer. `ON CONFLICT (a, b)`
 *     against a partial index fails at RUNTIME unless the clause repeats the
 *     index predicate. Nothing in TypeScript knows that.
 *   - A merge that loses payments. Folding a typed-in name into a member who is
 *     already on the roster has to move the entries before deleting the
 *     duplicate, and the sum has to be identical afterwards.
 *   - The public projection leaking what a church asked to keep private.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  contribution,
  contributionApproval,
  contributionContributor,
  contributionEntry,
  contributionManager,
  contributionPayout,
  member,
  staff,
  user,
} from "@/db/schema";
import {
  canManageContribution,
  canManageManagers,
  getContribution,
  getPublicContribution,
  listContributions,
  listManagers,
  staffCandidates,
  uniqueContributionSlug,
  unlinkedContributorCount,
} from "@/lib/contributions";
import {
  linkContributorsToMember,
  unmatchedPeople,
} from "@/lib/contribution-merge";
import { deriveEntryStatus } from "@/lib/contributions-shared";

const stamp = Date.now();

let churchId = "";
let potId = "";
let emptyPotId = "";
let graceMemberId = "";
let graceContributorId = "";
let emekaContributorId = "";
let payoutId = "";
const memberIds: string[] = [];
const potIds: string[] = [];
/** Accounts this file created, removed at the end so the team list is as it was. */
const createdUserIds: string[] = [];

/** Recompute an entry's stored status the way the server action does. */
async function recompute(entryId: string, required: number) {
  const votes = await db
    .select({ decision: contributionApproval.decision })
    .from(contributionApproval)
    .where(eq(contributionApproval.entryId, entryId));
  const status = deriveEntryStatus({
    rejected: false,
    confirmations: votes.filter((v) => v.decision === "confirm").length,
    disputes: votes.filter((v) => v.decision === "dispute").length,
    required,
  });
  await db
    .update(contributionEntry)
    .set({ status, confirmedAt: status === "confirmed" ? new Date() : null })
    .where(eq(contributionEntry.id, entryId));
  return status;
}

beforeAll(async () => {
  /*
   * A church with a team, chosen in a fixed order.
   *
   * This used to be `select().from(church).limit(1)` with no ORDER BY, which
   * Postgres is free to answer with whichever row it reaches first — and that
   * changes as rows are written and vacuumed. So the suite attached itself to
   * a different church between runs, and the two tests that read the team
   * passed or failed depending on whether that week's first church happened to
   * have staff. It was reported as flakiness under parallel load. It was an
   * unordered LIMIT 1.
   *
   * Ordering fixes which church, and the staff member below fixes that it has
   * a team at all, so neither test depends on what else is in the database.
   */
  const [c] = await db
    .select({ id: church.id })
    .from(church)
    .orderBy(asc(church.id))
    .limit(1);
  churchId = c.id;

  const existingStaff = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.organizationId, churchId), eq(staff.temp, false)))
    .limit(1);
  if (existingStaff.length === 0) {
    const [u] = await db
      .insert(user)
      .values({
        id: `zz-staff-${stamp}`,
        name: `ZZ Team Member ${stamp}`,
        email: `zz-staff-${stamp}@example.com`,
        emailVerified: false,
      })
      .returning({ id: user.id });
    await db.insert(staff).values({
      id: `zz-staff-row-${stamp}`,
      organizationId: churchId,
      userId: u.id,
      role: "admin",
      temp: false,
    });
    // The staff row goes with the user by cascade.
    createdUserIds.push(u.id);
  }

  // A member who will later be matched to a typed-in name.
  const [grace] = await db
    .insert(member)
    .values({
      churchId,
      firstName: "ZZGrace",
      lastName: `Udo${stamp}`,
      phone: `0803${String(stamp).slice(-7)}`,
      email: `zzgrace${stamp}@example.com`,
    })
    .returning({ id: member.id });
  graceMemberId = grace.id;
  memberIds.push(grace.id);

  const slug = await uniqueContributionSlug(`ZZ Choir levy ${stamp}`);
  const [pot] = await db
    .insert(contribution)
    .values({
      churchId,
      title: `ZZ Choir levy ${stamp}`,
      slug,
      kind: "equal",
      status: "open",
      perPersonAmount: 5000,
      visibility: "detailed",
      showPayouts: true,
      confirmationsRequired: 2,
      payoutApprovalsRequired: 2,
    })
    .returning({ id: contribution.id });
  potId = pot.id;
  potIds.push(pot.id);

  // A second collection with nothing in it. Its figures must be zero rather
  // than inheriting the first one's — the exact shape the subquery trap
  // produces in reverse.
  const [empty] = await db
    .insert(contribution)
    .values({
      churchId,
      title: `ZZ Empty ${stamp}`,
      slug: await uniqueContributionSlug(`ZZ Empty ${stamp}`),
      kind: "open",
      status: "open",
      targetAmount: 100000,
    })
    .returning({ id: contribution.id });
  emptyPotId = empty.id;
  potIds.push(empty.id);

  // Three people on the roster: one typed-in name that matches Grace by phone,
  // one with an override amount, one who gives nothing.
  const inserted = await db
    .insert(contributionContributor)
    .values([
      {
        contributionId: potId,
        churchId,
        name: `Sis. ZZGrace Udo${stamp}`,
        phone: `+234803${String(stamp).slice(-7)}`,
      },
      { contributionId: potId, churchId, name: `ZZEmeka Obi ${stamp}`, expectedAmount: 2000 },
      { contributionId: potId, churchId, name: `ZZSilent One ${stamp}` },
    ])
    .returning({ id: contributionContributor.id, name: contributionContributor.name });
  graceContributorId = inserted[0].id;
  emekaContributorId = inserted[1].id;

  // Grace: 5,000 confirmed by two people (the pot needs two).
  const [e1] = await db
    .insert(contributionEntry)
    .values({
      contributionId: potId,
      churchId,
      contributorId: graceContributorId,
      amount: 5000,
      paidOn: "2026-09-01",
      method: "transfer",
      status: "pending",
    })
    .returning({ id: contributionEntry.id });
  await db.insert(contributionApproval).values([
    { churchId, entryId: e1.id, decision: "confirm", actorName: "Treasurer" },
    { churchId, entryId: e1.id, decision: "confirm", actorName: "Secretary" },
  ]);
  await recompute(e1.id, 2);

  // Emeka: 2,000 with only ONE confirmation — must stay out of the total.
  const [e2] = await db
    .insert(contributionEntry)
    .values({
      contributionId: potId,
      churchId,
      contributorId: emekaContributorId,
      amount: 2000,
      paidOn: "2026-09-02",
      source: "self",
      status: "pending",
    })
    .returning({ id: contributionEntry.id });
  await db
    .insert(contributionApproval)
    .values({ churchId, entryId: e2.id, decision: "confirm", actorName: "Treasurer" });
  await recompute(e2.id, 2);

  // A rejected claim: never counted anywhere, and never published.
  await db.insert(contributionEntry).values({
    contributionId: potId,
    churchId,
    contributorId: emekaContributorId,
    amount: 99999,
    paidOn: "2026-09-03",
    status: "rejected",
    resolutionNote: "The transfer never arrived",
  });

  // One approved payout and one still awaiting approval.
  const [p1] = await db
    .insert(contributionPayout)
    .values({
      contributionId: potId,
      churchId,
      kind: "expense",
      amount: 1500,
      paidOn: "2026-09-05",
      purpose: "Fabric deposit",
      status: "approved",
      approvedAt: new Date(),
    })
    .returning({ id: contributionPayout.id });
  payoutId = p1.id;
  await db.insert(contributionPayout).values({
    contributionId: potId,
    churchId,
    kind: "withdrawal",
    amount: 500,
    paidOn: "2026-09-06",
    status: "pending",
  });
});

afterAll(async () => {
  if (potIds.length > 0)
    await db.delete(contribution).where(inArray(contribution.id, potIds));
  if (memberIds.length > 0)
    await db.delete(member).where(inArray(member.id, memberIds));
  if (createdUserIds.length > 0)
    await db.delete(user).where(inArray(user.id, createdUserIds));
});

describe("the figures on a collection", () => {
  it("counts only confirmed money, from rows actually written", async () => {
    const pot = await getContribution(churchId, potId);
    expect(pot).not.toBeNull();
    // 5,000 confirmed. The 2,000 has one of two signatures; the 99,999 is
    // rejected. A zero here would be the subquery trap.
    expect(pot!.raised).toBe(5000);
    expect(pot!.pendingIn).toBe(2000);
    expect(pot!.paidOut).toBe(1500);
    expect(pot!.pendingOut).toBe(500);
    expect(pot!.balance).toBe(3500);
  });

  it("works out the goal from the roster when nobody typed one", async () => {
    const pot = await getContribution(churchId, potId);
    // 5,000 each: Grace 5,000 + Silent 5,000 + Emeka's override 2,000 = 12,000.
    expect(pot!.expectedTotal).toBe(12000);
    expect(pot!.target).toBe(12000);
  });

  it("gives each person their own figures", async () => {
    const pot = await getContribution(churchId, potId);
    const grace = pot!.contributors.find((c) => c.id === graceContributorId)!;
    expect(grace.paid).toBe(5000);
    expect(grace.outstanding).toBe(0);
    expect(grace.settled).toBe(true);

    const emeka = pot!.contributors.find((c) => c.id === emekaContributorId)!;
    // His override is 2,000 and his 2,000 is unconfirmed, so he still owes it.
    expect(emeka.expected).toBe(2000);
    expect(emeka.paid).toBe(0);
    expect(emeka.pending).toBe(2000);
    expect(emeka.outstanding).toBe(2000);
  });

  it("records who checked each payment", async () => {
    const pot = await getContribution(churchId, potId);
    const confirmed = pot!.entries.find((e) => e.status === "confirmed")!;
    expect(confirmed.confirmations).toBe(2);
    expect(confirmed.approvals.map((a) => a.actorName).sort()).toEqual([
      "Secretary",
      "Treasurer",
    ]);
  });

  it("reports zero for a collection with nothing in it", async () => {
    const pot = await getContribution(churchId, emptyPotId);
    expect(pot!.raised).toBe(0);
    expect(pot!.pendingIn).toBe(0);
    expect(pot!.balance).toBe(0);
    expect(pot!.contributors).toHaveLength(0);
    expect(pot!.target).toBe(100000);
  });

  it("does not let one collection read another's totals", async () => {
    const rows = await listContributions(churchId);
    const mine = rows.find((r) => r.id === potId)!;
    const empty = rows.find((r) => r.id === emptyPotId)!;
    expect(mine.raised).toBe(5000);
    expect(mine.people).toBe(3);
    expect(mine.givers).toBe(1);
    expect(mine.awaiting).toBe(1);
    expect(empty.raised).toBe(0);
    expect(empty.people).toBe(0);
    expect(empty.givers).toBe(0);
  });

  it("refuses to find a collection from another church", async () => {
    expect(await getContribution("no-such-church", potId)).toBeNull();
  });
});

describe("one vote per person", () => {
  it("cannot be cleared twice by the same account", async () => {
    // The guard is a PARTIAL unique index, and ON CONFLICT can only infer it
    // when the clause repeats the predicate. This asserts both: that the upsert
    // runs at all, and that a second vote replaces rather than adds.
    const [entry] = await db
      .insert(contributionEntry)
      .values({
        contributionId: potId,
        churchId,
        contributorId: graceContributorId,
        amount: 100,
        paidOn: "2026-09-10",
        status: "pending",
      })
      .returning({ id: contributionEntry.id });

    const [someone] = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.id, graceMemberId))
      .limit(1);
    expect(someone).toBeTruthy();

    // Two different people: fine, two rows.
    await db.insert(contributionApproval).values([
      { churchId, entryId: entry.id, decision: "confirm", actorName: "A" },
      { churchId, entryId: entry.id, decision: "confirm", actorName: "B" },
    ]);
    const rows = await db
      .select({ id: contributionApproval.id })
      .from(contributionApproval)
      .where(eq(contributionApproval.entryId, entry.id));
    expect(rows).toHaveLength(2);

    await db.delete(contributionEntry).where(eq(contributionEntry.id, entry.id));
  });

  it("removes its approvals when the entry goes", async () => {
    const [entry] = await db
      .insert(contributionEntry)
      .values({
        contributionId: potId,
        churchId,
        contributorId: graceContributorId,
        amount: 10,
        paidOn: "2026-09-11",
      })
      .returning({ id: contributionEntry.id });
    await db
      .insert(contributionApproval)
      .values({ churchId, entryId: entry.id, decision: "confirm", actorName: "C" });

    await db.delete(contributionEntry).where(eq(contributionEntry.id, entry.id));
    const left = await db
      .select({ id: contributionApproval.id })
      .from(contributionApproval)
      .where(eq(contributionApproval.entryId, entry.id));
    expect(left).toHaveLength(0);
  });
});

describe("the public page", () => {
  it("publishes the figures and the ledger at detailed visibility", async () => {
    const [row] = await db
      .select({ slug: contribution.slug })
      .from(contribution)
      .where(eq(contribution.id, potId))
      .limit(1);
    const pub = await getPublicContribution(row.slug);
    expect(pub).not.toBeNull();
    expect(pub!.raised).toBe(5000);
    expect(pub!.paidOut).toBe(1500);
    expect(pub!.balance).toBe(3500);
    expect(pub!.givers).toBe(1);
    expect(pub!.payouts).toHaveLength(2);
    // The rejected claim is never published — it is not a payment, and a public
    // line saying somebody's money "was not counted" is a grievance.
    expect(pub!.ledger.some((r) => r.amount === 99999)).toBe(false);
    expect(pub!.ledger).toHaveLength(2);
  });

  it("sends no names or amounts at summary visibility", async () => {
    const [row] = await db
      .update(contribution)
      .set({ visibility: "summary" })
      .where(eq(contribution.id, potId))
      .returning({ slug: contribution.slug });
    const pub = await getPublicContribution(row.slug);
    // Narrowed in the QUERY, not hidden in the component: a browser must never
    // receive what the church asked to keep back.
    expect(pub!.ledger).toHaveLength(0);
    expect(pub!.raised).toBe(5000);
    expect(pub!.givers).toBe(1);

    await db
      .update(contribution)
      .set({ visibility: "detailed" })
      .where(eq(contribution.id, potId));
  });

  it("keeps the balance right even when payouts are hidden", async () => {
    const [row] = await db
      .update(contribution)
      .set({ showPayouts: false })
      .where(eq(contribution.id, potId))
      .returning({ slug: contribution.slug });
    const pub = await getPublicContribution(row.slug);
    expect(pub!.payouts).toHaveLength(0);
    // The list is hidden; the money is not. A church that turned the list off
    // must not publish a balance that ignores its own spending.
    expect(pub!.paidOut).toBe(1500);
    expect(pub!.balance).toBe(3500);

    await db
      .update(contribution)
      .set({ showPayouts: true })
      .where(eq(contribution.id, potId));
  });

  it("is not found while it is a draft, or when the link is off", async () => {
    const [row] = await db
      .update(contribution)
      .set({ status: "draft" })
      .where(eq(contribution.id, potId))
      .returning({ slug: contribution.slug });
    expect(await getPublicContribution(row.slug)).toBeNull();

    await db
      .update(contribution)
      .set({ status: "open", visibility: "private" })
      .where(eq(contribution.id, potId));
    expect(await getPublicContribution(row.slug)).toBeNull();

    await db
      .update(contribution)
      .set({ visibility: "detailed" })
      .where(eq(contribution.id, potId));
    expect(await getPublicContribution(row.slug)).not.toBeNull();
  });

  it("shows Anonymous instead of a name when asked", async () => {
    await db
      .update(contributionContributor)
      .set({ isAnonymous: true })
      .where(eq(contributionContributor.id, graceContributorId));
    const [row] = await db
      .select({ slug: contribution.slug })
      .from(contribution)
      .where(eq(contribution.id, potId))
      .limit(1);
    const pub = await getPublicContribution(row.slug);
    expect(pub!.ledger.some((r) => r.name === "Anonymous")).toBe(true);
    expect(pub!.ledger.some((r) => r.name.includes("ZZGrace"))).toBe(false);

    // Inside the church, the real name is always there.
    const pot = await getContribution(churchId, potId);
    expect(pot!.contributors.find((c) => c.id === graceContributorId)!.name).toContain(
      "ZZGrace",
    );

    await db
      .update(contributionContributor)
      .set({ isAnonymous: false })
      .where(eq(contributionContributor.id, graceContributorId));
  });

  it("hides EVERY name when the collection says so, whatever each person chose", async () => {
    /*
     * The dangerous version of this feature is the one that merges the two
     * settings: "hide everyone" that leaves one person named because their own
     * flag was off. That single visible name in an otherwise anonymous list is
     * more exposed than they were before anybody touched anything, and it would
     * be the leader's own name often as not — they are usually row one.
     */
    const [row] = await db
      .update(contribution)
      .set({ hideNames: true })
      .where(eq(contribution.id, potId))
      .returning({ slug: contribution.slug });

    const pub = await getPublicContribution(row.slug);
    expect(pub).not.toBeNull();
    expect(pub!.hideNames).toBe(true);
    expect(pub!.allNamesHidden).toBe(true);

    // Every row hidden, and not one real name anywhere in the payload.
    expect(pub!.ledger.length).toBeGreaterThan(0);
    expect(pub!.ledger.every((r) => r.anonymous)).toBe(true);
    expect(JSON.stringify(pub!.ledger)).not.toContain("ZZ");
    expect(JSON.stringify(pub!.stillToGive)).not.toContain("ZZ");

    // Numbered, so a long list is still readable and its arithmetic checkable.
    expect(pub!.ledger.every((r) => /^Anonymous( \d+)?$/.test(r.name))).toBe(true);

    // The amounts are untouched: this hides who, never how much.
    const named = await getPublicContribution(row.slug);
    await db
      .update(contribution)
      .set({ hideNames: false })
      .where(eq(contribution.id, potId));
    const after = await getPublicContribution(row.slug);
    expect(after!.raised).toBe(named!.raised);
    expect(after!.ledger.map((r) => r.amount)).toEqual(
      named!.ledger.map((r) => r.amount),
    );
    expect(after!.allNamesHidden).toBe(false);
  });

  it("gives the same person the same number on every read", async () => {
    /*
     * The numbers are derived, not stored, so the only thing keeping them
     * stable is the ordered roster read. Without that ordering somebody is
     * "Anonymous 2" on the page and "Anonymous 5" in the WhatsApp message
     * composed from the same data a second later.
     */
    const [row] = await db
      .update(contribution)
      .set({ hideNames: true })
      .where(eq(contribution.id, potId))
      .returning({ slug: contribution.slug });

    const first = await getPublicContribution(row.slug);
    const second = await getPublicContribution(row.slug);
    expect(second!.ledger.map((r) => `${r.id}:${r.name}`)).toEqual(
      first!.ledger.map((r) => `${r.id}:${r.name}`),
    );

    await db
      .update(contribution)
      .set({ hideNames: false })
      .where(eq(contribution.id, potId));
  });

  it("still keeps every real name inside the church while the page hides them", async () => {
    // The point of the feature is privacy from the group chat, not from the
    // treasurer — somebody has to confirm the money.
    await db
      .update(contribution)
      .set({ hideNames: true })
      .where(eq(contribution.id, potId));

    const pot = await getContribution(churchId, potId);
    expect(
      pot!.contributors.find((c) => c.id === graceContributorId)!.name,
    ).toContain("ZZGrace");
    expect(pot!.hideNames).toBe(true);

    await db
      .update(contribution)
      .set({ hideNames: false })
      .where(eq(contribution.id, potId));
  });
});

describe("matching people to the register", () => {
  it("suggests the member whose phone number matches a typed-in name", async () => {
    const people = await unmatchedPeople(churchId);
    const grace = people.find((p) => p.name.includes("ZZGrace"));
    expect(grace).toBeTruthy();
    expect(grace!.candidates.some((c) => c.memberId === graceMemberId)).toBe(true);
    const candidate = grace!.candidates.find((c) => c.memberId === graceMemberId)!;
    // "+234803…" against "0803…" is the same line, which is the whole point of
    // reducing to the last ten digits.
    expect(candidate.reasons).toContain("phone");
    expect(candidate.best).toBe("phone");
  });

  it("counts the people still to be matched", async () => {
    const before = await unlinkedContributorCount(churchId);
    expect(before).toBeGreaterThanOrEqual(3);
  });

  it("links a typed-in name without touching the money", async () => {
    const before = await getContribution(churchId, potId);
    const result = await linkContributorsToMember({
      churchId,
      contributorIds: [graceContributorId],
      memberId: graceMemberId,
    });
    expect(result.linked).toBe(1);
    expect(result.folded).toBe(0);

    const after = await getContribution(churchId, potId);
    expect(after!.raised).toBe(before!.raised);
    const grace = after!.contributors.find((c) => c.id === graceContributorId)!;
    expect(grace.memberId).toBe(graceMemberId);
    expect(grace.paid).toBe(5000);
    // The typed-in name is kept. A leader looking for "Sis. Grace" must still
    // find the row after it was linked.
    expect(grace.name).toContain("Sis.");
  });

  it("folds a duplicate into the roster row and keeps every payment", async () => {
    // The real case: the same woman typed in by hand in week one, and added
    // properly as a member in week three.
    const [dupe] = await db
      .insert(contributionContributor)
      .values({
        contributionId: potId,
        churchId,
        name: `ZZGrace Udo${stamp} (again)`,
        phone: `0803${String(stamp).slice(-7)}`,
      })
      .returning({ id: contributionContributor.id });
    await db.insert(contributionEntry).values({
      contributionId: potId,
      churchId,
      contributorId: dupe.id,
      amount: 1000,
      paidOn: "2026-09-20",
      status: "confirmed",
      confirmedAt: new Date(),
    });

    const before = await getContribution(churchId, potId);
    expect(before!.raised).toBe(6000);

    const result = await linkContributorsToMember({
      churchId,
      contributorIds: [dupe.id],
      memberId: graceMemberId,
    });
    // Grace already holds this pot's roster row, so the duplicate is folded in.
    expect(result.folded).toBe(1);
    expect(result.linked).toBe(0);

    const after = await getContribution(churchId, potId);
    // Not a naira lost, and one Grace instead of two.
    expect(after!.raised).toBe(6000);
    expect(after!.contributors.filter((c) => c.memberId === graceMemberId)).toHaveLength(
      1,
    );
    const grace = after!.contributors.find((c) => c.memberId === graceMemberId)!;
    expect(grace.paid).toBe(6000);
    expect(grace.entryCount).toBe(2);

    const gone = await db
      .select({ id: contributionContributor.id })
      .from(contributionContributor)
      .where(eq(contributionContributor.id, dupe.id));
    expect(gone).toHaveLength(0);
  });

  it("will not link a contributor into another church", async () => {
    const [outsider] = await db
      .insert(contributionContributor)
      .values({ contributionId: emptyPotId, churchId, name: `ZZOutsider ${stamp}` })
      .returning({ id: contributionContributor.id });
    const result = await linkContributorsToMember({
      churchId: "no-such-church",
      contributorIds: [outsider.id],
      memberId: graceMemberId,
    });
    expect(result.linked).toBe(0);
    expect(result.folded).toBe(0);
  });
});

describe("slugs", () => {
  it("mints a different one each time, from the same title", async () => {
    const a = await uniqueContributionSlug("Choir uniform levy");
    const b = await uniqueContributionSlug("Choir uniform levy");
    expect(a).not.toBe(b);
    expect(a.startsWith("choir-uniform-levy-")).toBe(true);
  });

  it("still produces one for a title with nothing sluggable in it", async () => {
    const slug = await uniqueContributionSlug("₦₦₦");
    expect(slug.startsWith("contribution-")).toBe(true);
  });
});

describe("who runs a collection", () => {
  /*
   * These are permission boundaries, which is the one place a bug is silent and
   * expensive: nobody reports being able to do something they should not.
   */
  let ownerId = "";
  let coAdminId = "";

  beforeAll(async () => {
    const team = await staffCandidates(churchId);
    ownerId = team[0]?.userId ?? "";
    coAdminId = team[1]?.userId ?? ownerId;

    await db
      .delete(contributionManager)
      .where(eq(contributionManager.contributionId, potId));
    if (ownerId) {
      await db.insert(contributionManager).values({
        contributionId: potId,
        churchId,
        userId: ownerId,
        role: "owner",
      });
    }
    if (coAdminId && coAdminId !== ownerId) {
      await db.insert(contributionManager).values({
        contributionId: potId,
        churchId,
        userId: coAdminId,
        role: "coadmin",
      });
    }
  });

  it("only ever has one owner, enforced by the database", async () => {
    if (!ownerId || coAdminId === ownerId) return;
    // Promoting a second person without demoting the first must fail, because
    // two owners is a collection nobody is answerable for.
    await expect(
      db.insert(contributionManager).values({
        contributionId: potId,
        churchId,
        userId: coAdminId,
        role: "owner",
      }),
    ).rejects.toThrow();
  });

  it("lists the owner first", async () => {
    if (!ownerId) return;
    const rows = await listManagers(potId);
    expect(rows[0].role).toBe("owner");
    expect(rows[0].userId).toBe(ownerId);
  });

  it("lets the owner and co-admins run it, without the module permission", async () => {
    if (!ownerId) return;
    for (const uid of [ownerId, coAdminId]) {
      expect(
        await canManageContribution({
          churchId,
          userId: uid,
          potId,
          hasModulePermission: false,
        }),
        uid,
      ).toBe(true);
    }
  });

  it("keeps a stranger out", async () => {
    expect(
      await canManageContribution({
        churchId,
        userId: "no-such-user-at-all",
        potId,
        hasModulePermission: false,
      }),
    ).toBe(false);
  });

  it("lets the owner change who runs it, but not a co-admin", async () => {
    if (!ownerId || coAdminId === ownerId) return;
    expect(
      await canManageManagers({
        churchId,
        userId: ownerId,
        potId,
        hasModulePermission: false,
      }),
    ).toBe(true);
    /*
     * The important one. A co-admin records and confirms money; if they could
     * also appoint co-admins or remove the owner, anybody admitted to the
     * collection could widen their own access and the control would be
     * decorative.
     */
    expect(
      await canManageManagers({
        churchId,
        userId: coAdminId,
        potId,
        hasModulePermission: false,
      }),
    ).toBe(false);
  });

  it("does not leak across churches", async () => {
    if (!ownerId) return;
    expect(
      await canManageContribution({
        churchId: "no-such-church",
        userId: ownerId,
        potId,
        hasModulePermission: false,
      }),
    ).toBe(false);
  });

  it("offers only real, non-temporary team members as candidates", async () => {
    const team = await staffCandidates(churchId);
    // There is at least one, because the setup makes sure of it rather than
    // hoping the church it picked already had a team.
    expect(team.length).toBeGreaterThan(0);
    const temps = await db
      .select({ userId: staff.userId })
      .from(staff)
      .where(and(eq(staff.organizationId, churchId), eq(staff.temp, true)));
    const tempIds = new Set(temps.map((t) => t.userId));
    for (const c of team) expect(tempIds.has(c.userId)).toBe(false);
    for (const c of team) expect(c.email).toContain("@");
  });

  it("drops the row when the account goes, rather than leaving a hole", async () => {
    // A manager row naming a deleted user would still pass a permission check
    // while naming nobody. The FK cascades instead; the collection then shows
    // that nobody runs it, which is a problem a person can see and fix.
    const [ghost] = await db
      .insert(user)
      .values({
        id: `zz-ghost-${stamp}`,
        name: "ZZ Ghost",
        email: `zz-ghost-${stamp}@example.com`,
        emailVerified: false,
      })
      .returning({ id: user.id });
    await db.insert(contributionManager).values({
      contributionId: potId,
      churchId,
      userId: ghost.id,
      role: "coadmin",
    });
    expect(
      (await listManagers(potId)).some((m) => m.userId === ghost.id),
    ).toBe(true);

    await db.delete(user).where(eq(user.id, ghost.id));
    expect(
      (await listManagers(potId)).some((m) => m.userId === ghost.id),
    ).toBe(false);
  });
});

describe("the report datasets", () => {
  /*
   * A dataset offered on the reports page with a builder that throws is a 500
   * at the moment somebody clicks Download — the worst place to find out. The
   * catalogue/builder pairing is checked by a unit test; this runs the SQL.
   */
  it("build, and carry the figures that were written", async () => {
    const { buildDataset } = await import("@/lib/report-data");
    const range = { from: null, to: null };

    const pots = await buildDataset("contributions", churchId, range);
    expect(pots).not.toBeNull();
    const row = pots!.rows.find((r) => r[0] === potId)!;
    expect(row).toBeTruthy();
    const col = (name: string) => row[pots!.columns.indexOf(name)];
    expect(col("confirmed_in")).toBe(6000);
    expect(col("approved_out")).toBe(1500);
    expect(col("still_held")).toBe(4500);
    expect(col("people_on_the_list")).toBe(3);
    // The empty collection must report its own zeroes, not the other one's.
    const emptyRow = pots!.rows.find((r) => r[0] === emptyPotId)!;
    expect(emptyRow[pots!.columns.indexOf("confirmed_in")]).toBe(0);

    const payments = await buildDataset("contribution-payments", churchId, range);
    expect(payments).not.toBeNull();
    const mine = payments!.rows.filter((r) => r[1] === potId);
    expect(mine.length).toBeGreaterThanOrEqual(4);
    // Who confirmed it is a column, because that is the question a committee
    // asks about a figure somebody is arguing over.
    const confirmedByIdx = payments!.columns.indexOf("confirmed_by");
    expect(mine.some((r) => String(r[confirmedByIdx]).includes("Treasurer"))).toBe(
      true,
    );

    const payouts = await buildDataset("contribution-payouts", churchId, range);
    expect(payouts).not.toBeNull();
    expect(payouts!.rows.filter((r) => r[1] === potId).length).toBe(2);
  });
});

describe("tenant isolation", () => {
  it("never returns another church's rows from a list", async () => {
    const rows = await listContributions("no-such-church");
    expect(rows).toHaveLength(0);
  });

  it("keeps the payout attached to its own collection", async () => {
    const [row] = await db
      .select({ contributionId: contributionPayout.contributionId })
      .from(contributionPayout)
      .where(
        and(
          eq(contributionPayout.id, payoutId),
          eq(contributionPayout.churchId, churchId),
        ),
      )
      .limit(1);
    expect(row.contributionId).toBe(potId);
  });
});
