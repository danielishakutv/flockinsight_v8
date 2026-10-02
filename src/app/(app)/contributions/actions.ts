"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church as churchTable,
  contribution,
  contributionApproval,
  contributionContributor,
  contributionEntry,
  contributionPayout,
  financeAccount,
  financeCategory,
  financeTransaction,
  group,
  media,
  member,
} from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, getAccess } from "@/lib/permissions";
import {
  canManageContribution,
  groupsLedBy,
  uniqueContributionSlug,
} from "@/lib/contributions";
import {
  createMemberFromContributor,
  dismissMatches,
  linkContributorsToMember,
  restoreMatches,
} from "@/lib/contribution-merge";
import {
  contributionPath,
  deriveEntryStatus,
  derivePayoutStatus,
  effectiveTarget,
  expectedFor,
  parseAmount,
  type EntryStatus,
} from "@/lib/contributions-shared";
import { audit, diffFields, summariseChanges } from "@/lib/audit";
import { notifyChurchManagers } from "@/lib/notifications";
import { formatMoney } from "@/lib/money";
import { memberLimitStatus } from "@/lib/plan-limits";
import { destroyFromCloudinary, type ResourceType } from "@/lib/cloudinary";

export type ActionResult<T = { id: string }> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const ok = <T extends object>(data: T) => ({ ok: true as const, ...data });
const fail = (error: string) => ({ ok: false as const, error });

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const money = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : parseAmount(v)),
  z
    .number()
    .min(0, "An amount can't be negative")
    .max(1_000_000_000_000, "That amount is too large")
    .nullable(),
);

const positiveMoney = z.preprocess(
  (v) => parseAmount(v),
  z
    .number({ message: "Enter an amount" })
    .positive("The amount must be more than zero")
    .max(1_000_000_000_000, "That amount is too large"),
);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date");
const METHODS = ["cash", "transfer", "card", "cheque", "online", "other"] as const;

/* ============================================================
 * Guards
 * ========================================================== */

/**
 * Who may touch one pot.
 *
 * Resolved here rather than per action, because the rule has three routes in
 * (the module permission, having created the pot, or leading its group) and a
 * rule copied into fifteen actions is a rule that will be wrong in one of them.
 * See `canManageContribution` for why a group leader has to be enough.
 */
async function guardPot(potId: string) {
  const { church, user } = await requireChurch();
  const access = await getAccess();
  const allowed = await canManageContribution({
    churchId: church.id,
    userId: user.id,
    potId,
    hasModulePermission: access.isOwner || access.perms.has("contributions.manage"),
  });
  if (!allowed) return null;
  return { church, user };
}

/** The whole pot row, scoped to the church. */
async function loadPot(churchId: string, potId: string) {
  const [row] = await db
    .select()
    .from(contribution)
    .where(and(eq(contribution.id, potId), eq(contribution.churchId, churchId)))
    .limit(1);
  return row ?? null;
}

function refresh(potId?: string) {
  revalidatePath("/contributions");
  revalidatePath("/contributions/people");
  if (potId) revalidatePath(`/contributions/${potId}`);
}

/** The public page is a cached read of a slug; a change has to reach it. */
function refreshPublic(slug: string) {
  revalidatePath(contributionPath(slug));
}

/* ============================================================
 * Creating and editing a pot
 * ========================================================== */

const potSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(2, "Give it a name").max(140),
  purpose: z.preprocess(emptyToNull, z.string().trim().max(2000).nullable()),
  kind: z.enum(["equal", "open", "gift"]),
  groupId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  targetAmount: money,
  perPersonAmount: money,
  payInstructions: z.preprocess(emptyToNull, z.string().trim().max(600).nullable()),
  honoureeMemberId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  honoureeName: z.preprocess(emptyToNull, z.string().trim().max(160).nullable()),
  startDate: z.preprocess(emptyToNull, isoDate.nullable()),
  dueDate: z.preprocess(emptyToNull, isoDate.nullable()),
  visibility: z.enum(["private", "summary", "detailed"]),
  showOutstanding: z.boolean(),
  showPayouts: z.boolean(),
  showNotes: z.boolean(),
  allowSelfReport: z.boolean(),
  askForProof: z.boolean(),
  confirmationsRequired: z.coerce.number().int().min(1).max(5),
  payoutApprovalsRequired: z.coerce.number().int().min(1).max(5),
  keepProofs: z.boolean(),
});

export type PotInput = z.input<typeof potSchema>;

export async function saveContribution(
  input: PotInput,
): Promise<ActionResult<{ id: string; slug: string }>> {
  const parsed = potSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Please check the form.");
  const d = parsed.data;

  const { church, user } = await requireChurch();

  if (d.dueDate && d.startDate && d.dueDate < d.startDate)
    return fail("The deadline can't be before the start date.");

  // A group, if named, must be this church's.
  if (d.groupId) {
    const [g] = await db
      .select({ id: group.id })
      .from(group)
      .where(and(eq(group.id, d.groupId), eq(group.churchId, church.id)))
      .limit(1);
    if (!g) return fail("That group doesn't exist.");
  }

  // An honouree, if named, must be this church's member.
  let honoureeName = d.honoureeName;
  if (d.honoureeMemberId) {
    const [m] = await db
      .select({ firstName: member.firstName, lastName: member.lastName })
      .from(member)
      .where(and(eq(member.id, d.honoureeMemberId), eq(member.churchId, church.id)))
      .limit(1);
    if (!m) return fail("That person isn't in your congregation.");
    honoureeName = [m.firstName, m.lastName].filter(Boolean).join(" ");
  }

  if (d.id) {
    const guard = await guardPot(d.id);
    if (!guard) return fail("You can't edit this collection.");
    const before = await loadPot(church.id, d.id);
    if (!before) return fail("That collection no longer exists.");

    const patch = {
      title: d.title,
      purpose: d.purpose,
      kind: d.kind,
      groupId: d.groupId,
      targetAmount: d.targetAmount,
      perPersonAmount: d.perPersonAmount,
      payInstructions: d.payInstructions,
      honoureeMemberId: d.honoureeMemberId,
      honoureeName,
      startDate: d.startDate,
      dueDate: d.dueDate,
      visibility: d.visibility,
      showOutstanding: d.showOutstanding,
      showPayouts: d.showPayouts,
      showNotes: d.showNotes,
      allowSelfReport: d.allowSelfReport,
      askForProof: d.askForProof,
      confirmationsRequired: d.confirmationsRequired,
      payoutApprovalsRequired: d.payoutApprovalsRequired,
      keepProofs: d.keepProofs,
    };
    await db.update(contribution).set(patch).where(eq(contribution.id, d.id));

    const changes = diffFields(before, patch);
    await audit({
      churchId: church.id,
      action: "contributions.contribution.update",
      summary: `Edited the collection "${d.title}"${changes.length ? ` — ${summariseChanges(changes)}` : ""}`,
      targetType: "contribution",
      targetId: d.id,
      targetLabel: d.title,
      meta: { changes },
    });

    /*
     * The per-person amount changes what everybody owes, and the goal with it,
     * so the "goal reached" flag has to be re-decided here as well as after a
     * payment. Otherwise lowering a target leaves a reached goal uncelebrated,
     * and raising one leaves a banner claiming a goal that is no longer met.
     */
    await refreshGoalReached(church.id, d.id);
    refresh(d.id);
    refreshPublic(before.slug);
    return ok({ id: d.id, slug: before.slug });
  }

  // ----- Creating -----
  const access = await getAccess();
  const hasPermission = access.isOwner || access.perms.has("contributions.manage");
  if (!hasPermission) {
    /*
     * A group leader may start a collection for a group they lead, and only
     * that. This is the door that makes the feature work at all: the choir
     * leader who actually runs the levy is almost never a church administrator,
     * and routing every collection through the two people with admin rights is
     * the bottleneck the paper notebook does not have.
     */
    const led = await groupsLedBy(church.id, user.id);
    if (led.length === 0)
      return fail("You don't have permission to start a collection.");
    if (!d.groupId || !led.includes(d.groupId))
      return fail("You can only start a collection for a group you lead.");
  }

  const slug = await uniqueContributionSlug(d.title);
  const [created] = await db
    .insert(contribution)
    .values({
      churchId: church.id,
      groupId: d.groupId,
      title: d.title,
      purpose: d.purpose,
      kind: d.kind,
      slug,
      status: "draft",
      targetAmount: d.targetAmount,
      perPersonAmount: d.perPersonAmount,
      payInstructions: d.payInstructions,
      honoureeMemberId: d.honoureeMemberId,
      honoureeName,
      startDate: d.startDate,
      dueDate: d.dueDate,
      visibility: d.visibility,
      showOutstanding: d.showOutstanding,
      showPayouts: d.showPayouts,
      showNotes: d.showNotes,
      allowSelfReport: d.allowSelfReport,
      askForProof: d.askForProof,
      confirmationsRequired: d.confirmationsRequired,
      payoutApprovalsRequired: d.payoutApprovalsRequired,
      keepProofs: d.keepProofs,
      createdBy: user.id,
    })
    .returning({ id: contribution.id, slug: contribution.slug });
  if (!created) return fail("Could not create the collection.");

  await audit({
    churchId: church.id,
    action: "contributions.contribution.create",
    summary: `Started the collection "${d.title}"`,
    targetType: "contribution",
    targetId: created.id,
    targetLabel: d.title,
  });

  refresh(created.id);
  return ok({ id: created.id, slug: created.slug });
}

const STATUSES = ["draft", "open", "closed", "settled"] as const;

export async function setContributionStatus(
  id: string,
  status: (typeof STATUSES)[number],
): Promise<ActionResult> {
  if (!STATUSES.includes(status)) return fail("Unknown status.");
  const guard = await guardPot(id);
  if (!guard) return fail("You can't change this collection.");
  const pot = await loadPot(guard.church.id, id);
  if (!pot) return fail("That collection no longer exists.");

  /*
   * Settling means "every naira is accounted for", and claiming it while money
   * is still unaccounted for would make the word worthless. So the figures are
   * checked rather than trusted: confirmed in, approved out, and anything still
   * waiting on a signature.
   */
  if (status === "settled") {
    const unresolved = await db
      .select({ n: sql<string>`count(*)` })
      .from(contributionEntry)
      .where(
        and(
          eq(contributionEntry.contributionId, id),
          inArray(contributionEntry.status, ["pending", "disputed"]),
        ),
      );
    if (Number(unresolved[0]?.n ?? 0) > 0)
      return fail(
        "Some payments are still waiting to be confirmed or are disputed. Settle those first.",
      );

    const pendingOut = await db
      .select({ n: sql<string>`count(*)` })
      .from(contributionPayout)
      .where(
        and(
          eq(contributionPayout.contributionId, id),
          eq(contributionPayout.status, "pending"),
        ),
      );
    if (Number(pendingOut[0]?.n ?? 0) > 0)
      return fail("Some payments out are still waiting for approval.");
  }

  await db
    .update(contribution)
    .set({
      status,
      // Timestamps are set on the way in and cleared on the way back out, so
      // reopening a collection does not leave it claiming it was closed today.
      closedAt:
        status === "closed" || status === "settled" ? (pot.closedAt ?? new Date()) : null,
      settledAt: status === "settled" ? (pot.settledAt ?? new Date()) : null,
    })
    .where(eq(contribution.id, id));

  await audit({
    churchId: guard.church.id,
    action:
      status === "open"
        ? "contributions.contribution.open"
        : status === "settled"
          ? "contributions.contribution.settle"
          : "contributions.contribution.update",
    summary: `Marked the collection "${pot.title}" as ${status === "open" ? "collecting" : status}`,
    targetType: "contribution",
    targetId: id,
    targetLabel: pot.title,
    severity: status === "settled" ? "notice" : "info",
  });

  refresh(id);
  refreshPublic(pot.slug);
  return ok({ id });
}

export async function deleteContribution(id: string): Promise<ActionResult> {
  const guard = await guardPot(id);
  if (!guard) return fail("You can't delete this collection.");
  const pot = await loadPot(guard.church.id, id);
  if (!pot) return fail("That collection no longer exists.");

  /*
   * A collection with confirmed money in it is not deleted, it is closed.
   *
   * Deleting would take the record of what forty people paid with it, and that
   * record is the only thing standing between the treasurer and an argument
   * they cannot win. Closing keeps everything and stops the link.
   */
  const [confirmed] = await db
    .select({ n: sql<string>`count(*)` })
    .from(contributionEntry)
    .where(
      and(
        eq(contributionEntry.contributionId, id),
        eq(contributionEntry.status, "confirmed"),
      ),
    );
  if (Number(confirmed?.n ?? 0) > 0)
    return fail(
      "This collection has confirmed payments, so it can't be deleted. Close it instead — the record stays and the link stops working.",
    );

  // Receipts attached to a collection nobody will ever read again are deleted
  // with it, rather than left billing the church for an empty folder.
  await releaseProofsFor(guard.church.id, id);

  await db.delete(contribution).where(eq(contribution.id, id));

  await audit({
    churchId: guard.church.id,
    action: "contributions.contribution.delete",
    summary: `Deleted the collection "${pot.title}"`,
    targetType: "contribution",
    targetId: id,
    targetLabel: pot.title,
    severity: "warning",
  });

  refresh();
  refreshPublic(pot.slug);
  return ok({ id });
}

/* ============================================================
 * The roster
 * ========================================================== */

const contributorSchema = z.object({
  id: z.string().uuid().optional(),
  contributionId: z.string().uuid(),
  memberId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  name: z.preprocess(emptyToNull, z.string().trim().max(160).nullable()),
  phone: z.preprocess(emptyToNull, z.string().trim().max(40).nullable()),
  email: z.preprocess(emptyToNull, z.string().trim().email("That email looks wrong").max(200).nullable()),
  expectedAmount: money,
  isAnonymous: z.boolean().default(false),
  note: z.preprocess(emptyToNull, z.string().trim().max(500).nullable()),
});

export type ContributorInput = z.input<typeof contributorSchema>;

export async function saveContributor(
  input: ContributorInput,
): Promise<ActionResult> {
  const parsed = contributorSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Please check the form.");
  const d = parsed.data;

  const guard = await guardPot(d.contributionId);
  if (!guard) return fail("You can't change this collection.");
  const pot = await loadPot(guard.church.id, d.contributionId);
  if (!pot) return fail("That collection no longer exists.");

  // A linked member brings their own name and contact details.
  let name = d.name;
  let phone = d.phone;
  let email = d.email;
  if (d.memberId) {
    const [m] = await db
      .select({
        firstName: member.firstName,
        lastName: member.lastName,
        phone: member.phone,
        email: member.email,
      })
      .from(member)
      .where(and(eq(member.id, d.memberId), eq(member.churchId, guard.church.id)))
      .limit(1);
    if (!m) return fail("That person isn't in your congregation.");
    name = name || [m.firstName, m.lastName].filter(Boolean).join(" ");
    phone = phone ?? m.phone;
    email = email ?? m.email;
  }
  if (!name) return fail("Enter a name.");

  if (d.id) {
    const [existing] = await db
      .select({ id: contributionContributor.id, name: contributionContributor.name })
      .from(contributionContributor)
      .where(
        and(
          eq(contributionContributor.id, d.id),
          eq(contributionContributor.contributionId, d.contributionId),
        ),
      )
      .limit(1);
    if (!existing) return fail("That person isn't on this list.");

    await db
      .update(contributionContributor)
      .set({
        memberId: d.memberId,
        name,
        phone,
        email,
        expectedAmount: d.expectedAmount,
        isAnonymous: d.isAnonymous,
        note: d.note,
      })
      .where(eq(contributionContributor.id, d.id));

    await audit({
      churchId: guard.church.id,
      action: "contributions.person.update",
      summary: `Updated ${name} on "${pot.title}"`,
      targetType: "contribution",
      targetId: pot.id,
      targetLabel: pot.title,
    });
    await refreshGoalReached(guard.church.id, pot.id);
    refresh(pot.id);
    refreshPublic(pot.slug);
    return ok({ id: d.id });
  }

  // A member already on the roster is not added twice — their row is returned
  // so the caller lands on the person who is already there.
  if (d.memberId) {
    const [dupe] = await db
      .select({ id: contributionContributor.id })
      .from(contributionContributor)
      .where(
        and(
          eq(contributionContributor.contributionId, d.contributionId),
          eq(contributionContributor.memberId, d.memberId),
        ),
      )
      .limit(1);
    if (dupe) return fail(`${name} is already on this list.`);
  }

  const [created] = await db
    .insert(contributionContributor)
    .values({
      contributionId: d.contributionId,
      churchId: guard.church.id,
      memberId: d.memberId,
      name,
      phone,
      email,
      expectedAmount: d.expectedAmount,
      isAnonymous: d.isAnonymous,
      note: d.note,
    })
    .returning({ id: contributionContributor.id });
  if (!created) return fail("Could not add that person.");

  await audit({
    churchId: guard.church.id,
    action: "contributions.person.create",
    summary: `Added ${name} to "${pot.title}"`,
    targetType: "contribution",
    targetId: pot.id,
    targetLabel: pot.title,
  });
  await refreshGoalReached(guard.church.id, pot.id);
  refresh(pot.id);
  refreshPublic(pot.slug);
  return ok({ id: created.id });
}

/**
 * Paste a list of names, one per line.
 *
 * The single most useful thing in this module, and the reason it can replace a
 * notebook rather than sit beside one. A choir leader has the names in a
 * WhatsApp message already; retyping forty of them into forty dialogs is where
 * software loses to paper. Names, "Name, 08031234567" and
 * "Name, email, 2000" all work, because people paste what they have.
 *
 * Anyone whose name exactly matches a member is linked on the spot — the same
 * exact-match rule as the merge screen, which is safe enough to apply without
 * asking. Everyone else goes in as a name and surfaces there later.
 */
export async function importContributors(opts: {
  contributionId: string;
  text: string;
}): Promise<
  ActionResult<{ added: number; linked: number; skipped: number; total: number }>
> {
  const guard = await guardPot(opts.contributionId);
  if (!guard) return fail("You can't change this collection.");
  const pot = await loadPot(guard.church.id, opts.contributionId);
  if (!pot) return fail("That collection no longer exists.");

  const MAX_LINES = 500;
  const lines = (opts.text ?? "")
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_LINES);
  if (lines.length === 0) return fail("Paste at least one name.");

  type Parsed = {
    name: string;
    phone: string | null;
    email: string | null;
    expected: number | null;
  };
  const parsedRows: Parsed[] = [];
  for (const line of lines) {
    // Commas, tabs and semicolons all separate, because a paste out of a
    // spreadsheet and a paste out of WhatsApp do not agree on which.
    const parts = line
      .split(/[,;\t]/)
      .map((p) => p.trim())
      .filter(Boolean);
    const name = parts.shift();
    if (!name) continue;

    let phone: string | null = null;
    let email: string | null = null;
    let expected: number | null = null;
    for (const part of parts) {
      if (part.includes("@")) {
        email ??= part.slice(0, 200);
        continue;
      }
      const digits = part.replace(/\D/g, "");
      // Seven digits or more is a phone number; anything shorter that parses as
      // a number is an amount. A bare "2000" is an amount, "08031234567" is not.
      if (digits.length >= 7 && /^[+\d][\d\s()+-]*$/.test(part)) {
        phone ??= part.slice(0, 40);
        continue;
      }
      const amount = parseAmount(part);
      if (amount !== null && amount >= 0) expected ??= amount;
    }
    parsedRows.push({ name: name.slice(0, 160), phone, email, expected });
  }

  if (parsedRows.length === 0) return fail("Couldn't read any names from that.");

  // Who is already on this list, so a second paste of the same message does not
  // double everybody.
  const existing = await db
    .select({
      id: contributionContributor.id,
      name: contributionContributor.name,
      memberId: contributionContributor.memberId,
    })
    .from(contributionContributor)
    .where(eq(contributionContributor.contributionId, opts.contributionId));

  const { nameKey } = await import("@/lib/contributions-shared");
  const takenNames = new Set(existing.map((e) => nameKey(e.name)));
  const takenMembers = new Set(existing.map((e) => e.memberId).filter(Boolean));

  // The register, for exact-match linking on the way in.
  const members = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      phone: member.phone,
      email: member.email,
    })
    .from(member)
    .where(eq(member.churchId, guard.church.id));
  const { matchReasons, bestReason } = await import("@/lib/contributions-shared");

  let added = 0;
  let linked = 0;
  let skipped = 0;
  const values: (typeof contributionContributor.$inferInsert)[] = [];

  for (const row of parsedRows) {
    const key = nameKey(row.name);
    if (key && takenNames.has(key)) {
      skipped++;
      continue;
    }

    let memberId: string | null = null;
    for (const m of members) {
      const reasons = matchReasons(row, m);
      const best = bestReason(reasons);
      // Only an identifier links itself. A name match is offered on the merge
      // screen, never applied silently to a bulk paste — forty rows is exactly
      // where a wrong guess would go unnoticed.
      if (best === "email" || best === "phone") {
        memberId = m.id;
        break;
      }
    }
    if (memberId && takenMembers.has(memberId)) {
      skipped++;
      continue;
    }
    if (memberId) {
      takenMembers.add(memberId);
      linked++;
    }
    if (key) takenNames.add(key);

    values.push({
      contributionId: opts.contributionId,
      churchId: guard.church.id,
      memberId,
      name: row.name,
      phone: row.phone,
      email: row.email,
      expectedAmount: row.expected,
    });
    added++;
  }

  if (values.length > 0) {
    await db.insert(contributionContributor).values(values);
  }

  await audit({
    churchId: guard.church.id,
    action: "contributions.person.import",
    summary: `Added ${added} ${added === 1 ? "person" : "people"} to "${pot.title}" from a pasted list${linked ? `, ${linked} matched to member records` : ""}`,
    targetType: "contribution",
    targetId: pot.id,
    targetLabel: pot.title,
    meta: { added, linked, skipped, lines: lines.length },
  });

  await refreshGoalReached(guard.church.id, pot.id);
  refresh(pot.id);
  refreshPublic(pot.slug);
  return ok({ added, linked, skipped, total: parsedRows.length });
}

export async function removeContributor(id: string): Promise<ActionResult> {
  const { church } = await requireChurch();
  const [row] = await db
    .select({
      id: contributionContributor.id,
      name: contributionContributor.name,
      contributionId: contributionContributor.contributionId,
    })
    .from(contributionContributor)
    .where(
      and(
        eq(contributionContributor.id, id),
        eq(contributionContributor.churchId, church.id),
      ),
    )
    .limit(1);
  if (!row) return fail("That person isn't on this list.");

  const guard = await guardPot(row.contributionId);
  if (!guard) return fail("You can't change this collection.");
  const pot = await loadPot(church.id, row.contributionId);
  if (!pot) return fail("That collection no longer exists.");

  // Removing somebody who has paid would delete their payments with them
  // (the entries cascade), which is a silent way to lose money from the record.
  const [paid] = await db
    .select({ n: sql<string>`count(*)` })
    .from(contributionEntry)
    .where(eq(contributionEntry.contributorId, id));
  if (Number(paid?.n ?? 0) > 0)
    return fail(
      `${row.name} has payments recorded, so removing them would delete those too. Remove the payments first if they are wrong.`,
    );

  await db.delete(contributionContributor).where(eq(contributionContributor.id, id));

  await audit({
    churchId: church.id,
    action: "contributions.person.remove",
    summary: `Removed ${row.name} from "${pot.title}"`,
    targetType: "contribution",
    targetId: pot.id,
    targetLabel: pot.title,
    severity: "warning",
  });

  await refreshGoalReached(church.id, pot.id);
  refresh(pot.id);
  refreshPublic(pot.slug);
  return ok({ id });
}

/* ============================================================
 * Payments in
 * ========================================================== */

const entrySchema = z.object({
  id: z.string().uuid().optional(),
  contributionId: z.string().uuid(),
  /** An existing roster row... */
  contributorId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  /** ...or a name to put on it, which creates the roster row. */
  contributorName: z.preprocess(emptyToNull, z.string().trim().max(160).nullable()),
  memberId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  phone: z.preprocess(emptyToNull, z.string().trim().max(40).nullable()),
  amount: positiveMoney,
  method: z.preprocess(emptyToNull, z.enum(METHODS).nullable()),
  paidOn: isoDate,
  reference: z.preprocess(emptyToNull, z.string().trim().max(120).nullable()),
  note: z.preprocess(emptyToNull, z.string().trim().max(500).nullable()),
  proofMediaId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
});

export type EntryInput = z.input<typeof entrySchema>;

export async function recordEntry(input: EntryInput): Promise<ActionResult> {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Please check the form.");
  const d = parsed.data;

  const guard = await guardPot(d.contributionId);
  if (!guard) return fail("You can't record payments on this collection.");
  const pot = await loadPot(guard.church.id, d.contributionId);
  if (!pot) return fail("That collection no longer exists.");
  if (pot.status === "settled")
    return fail("This collection is settled. Reopen it to record anything else.");

  const contributorId = await resolveContributor({
    churchId: guard.church.id,
    contributionId: d.contributionId,
    contributorId: d.contributorId,
    name: d.contributorName,
    memberId: d.memberId,
    phone: d.phone,
  });
  if (!contributorId) return fail("Say who this payment is from.");

  const proofMediaId = await claimProof(guard.church.id, d.proofMediaId);

  if (d.id) {
    const [before] = await db
      .select()
      .from(contributionEntry)
      .where(
        and(
          eq(contributionEntry.id, d.id),
          eq(contributionEntry.contributionId, d.contributionId),
        ),
      )
      .limit(1);
    if (!before) return fail("That payment no longer exists.");

    await db
      .update(contributionEntry)
      .set({
        contributorId,
        amount: d.amount,
        method: d.method,
        paidOn: d.paidOn,
        reference: d.reference,
        note: d.note,
        proofMediaId: proofMediaId ?? before.proofMediaId,
      })
      .where(eq(contributionEntry.id, d.id));

    /*
     * Changing an amount clears the confirmations it had.
     *
     * The signatures were given for a figure, not for a row. Keeping them would
     * let somebody record 2,000, collect a colleague's confirmation, and then
     * quietly edit it to 20,000 with the approval still attached — which is
     * precisely the fraud the two-signature setting exists to prevent.
     */
    if (before.amount !== d.amount) {
      await db
        .delete(contributionApproval)
        .where(eq(contributionApproval.entryId, d.id));
    }
    await recomputeEntry(d.id, pot.confirmationsRequired);

    const changes = diffFields(before, {
      amount: d.amount,
      method: d.method,
      paidOn: d.paidOn,
      reference: d.reference,
      note: d.note,
    });
    await audit({
      churchId: guard.church.id,
      action: "contributions.payment.update",
      summary: `Edited a ${formatMoney(d.amount, guard.church.currency)} payment on "${pot.title}"${before.amount !== d.amount ? " — confirmations were cleared because the amount changed" : ""}`,
      targetType: "contribution",
      targetId: pot.id,
      targetLabel: pot.title,
      meta: { entryId: d.id, changes },
      severity: before.amount !== d.amount ? "notice" : "info",
    });

    await refreshGoalReached(guard.church.id, pot.id);
    refresh(pot.id);
    refreshPublic(pot.slug);
    return ok({ id: d.id });
  }

  const [created] = await db
    .insert(contributionEntry)
    .values({
      contributionId: d.contributionId,
      churchId: guard.church.id,
      contributorId,
      amount: d.amount,
      method: d.method,
      paidOn: d.paidOn,
      reference: d.reference,
      note: d.note,
      proofMediaId,
      source: "recorded",
      status: "pending",
      recordedBy: guard.user.id,
      recordedByName: guard.user.name || guard.user.email,
    })
    .returning({ id: contributionEntry.id });
  if (!created) return fail("Could not record that payment.");

  /*
   * The person recording it is the first signature.
   *
   * In a one-signature collection that makes a leader's own entry count
   * immediately, which is what they expect — they just counted the cash. In a
   * two-signature collection it counts as one of the two, so a second person
   * still has to agree before the money is in the total. One mechanism, both
   * behaviours, and no special case that could be forgotten.
   */
  await db.insert(contributionApproval).values({
    churchId: guard.church.id,
    entryId: created.id,
    decision: "confirm",
    userId: guard.user.id,
    actorName: guard.user.name || guard.user.email,
    note: "Recorded this payment",
  });
  await recomputeEntry(created.id, pot.confirmationsRequired);

  await audit({
    churchId: guard.church.id,
    action: "contributions.payment.create",
    summary: `Recorded ${formatMoney(d.amount, guard.church.currency)} toward "${pot.title}"`,
    targetType: "contribution",
    targetId: pot.id,
    targetLabel: pot.title,
    meta: { entryId: created.id, contributorId },
  });

  await refreshGoalReached(guard.church.id, pot.id);
  refresh(pot.id);
  refreshPublic(pot.slug);
  return ok({ id: created.id });
}

export async function deleteEntry(id: string): Promise<ActionResult> {
  const { church } = await requireChurch();
  const [row] = await db
    .select()
    .from(contributionEntry)
    .where(
      and(eq(contributionEntry.id, id), eq(contributionEntry.churchId, church.id)),
    )
    .limit(1);
  if (!row) return fail("That payment no longer exists.");

  const guard = await guardPot(row.contributionId);
  if (!guard) return fail("You can't change this collection.");
  const pot = await loadPot(church.id, row.contributionId);
  if (!pot) return fail("That collection no longer exists.");

  if (row.proofMediaId) await deleteProofFile(church.id, row.proofMediaId);
  await db.delete(contributionEntry).where(eq(contributionEntry.id, id));

  await audit({
    churchId: church.id,
    action: "contributions.payment.delete",
    summary: `Deleted a ${formatMoney(row.amount, church.currency)} payment from "${pot.title}"`,
    targetType: "contribution",
    targetId: pot.id,
    targetLabel: pot.title,
    meta: { entryId: id, amount: row.amount },
    severity: "warning",
  });

  await refreshGoalReached(church.id, pot.id);
  refresh(pot.id);
  refreshPublic(pot.slug);
  return ok({ id });
}

/* ============================================================
 * Confirming, disputing, rejecting
 * ========================================================== */

export async function voteOnEntry(opts: {
  entryId: string;
  decision: "confirm" | "dispute";
  note?: string | null;
}): Promise<ActionResult<{ status: EntryStatus }>> {
  const { church, user } = await requireChurch();
  const [row] = await db
    .select({
      id: contributionEntry.id,
      contributionId: contributionEntry.contributionId,
      amount: contributionEntry.amount,
      status: contributionEntry.status,
    })
    .from(contributionEntry)
    .where(
      and(
        eq(contributionEntry.id, opts.entryId),
        eq(contributionEntry.churchId, church.id),
      ),
    )
    .limit(1);
  if (!row) return fail("That payment no longer exists.");

  const guard = await guardPot(row.contributionId);
  if (!guard) return fail("You can't confirm payments on this collection.");
  const pot = await loadPot(church.id, row.contributionId);
  if (!pot) return fail("That collection no longer exists.");

  if (opts.decision === "dispute" && !opts.note?.trim())
    return fail("Say what is wrong with it — a dispute with no reason helps nobody.");

  const note = opts.note?.trim().slice(0, 500) || null;

  /*
   * One vote per person, updated rather than added to.
   *
   * The unique index is the real guarantee; this upsert is how changing your
   * mind works. Without it, clicking Confirm twice in a two-signature
   * collection would clear the requirement single-handed and the control would
   * be decorative.
   */
  await db
    .insert(contributionApproval)
    .values({
      churchId: church.id,
      entryId: opts.entryId,
      decision: opts.decision,
      userId: user.id,
      actorName: user.name || user.email,
      note,
    })
    /*
     * `targetWhere` is not optional here.
     *
     * The unique index is PARTIAL — it only covers rows where both the entry
     * and the user are set, because an approval row always has exactly one of
     * entry/payout. Postgres will only infer a partial index when the ON
     * CONFLICT clause repeats its predicate, and without it this fails at
     * runtime with "no unique or exclusion constraint matching the ON CONFLICT
     * specification" rather than at compile time.
     */
    .onConflictDoUpdate({
      target: [contributionApproval.entryId, contributionApproval.userId],
      targetWhere: sql`${contributionApproval.entryId} is not null and ${contributionApproval.userId} is not null`,
      set: { decision: opts.decision, note, createdAt: new Date() },
    });

  // A dispute clears a rejection: somebody is arguing about it again, so it is
  // back in the open rather than filed away.
  if (opts.decision === "dispute" && row.status === "rejected") {
    await db
      .update(contributionEntry)
      .set({ resolutionNote: note })
      .where(eq(contributionEntry.id, opts.entryId));
  }

  const status = await recomputeEntry(opts.entryId, pot.confirmationsRequired, {
    resolutionNote: opts.decision === "dispute" ? note : undefined,
  });

  await audit({
    churchId: church.id,
    action:
      opts.decision === "confirm"
        ? "contributions.payment.confirm"
        : "contributions.payment.dispute",
    summary:
      opts.decision === "confirm"
        ? `Confirmed a ${formatMoney(row.amount, church.currency)} payment on "${pot.title}"`
        : `Disputed a ${formatMoney(row.amount, church.currency)} payment on "${pot.title}" — ${note}`,
    targetType: "contribution",
    targetId: pot.id,
    targetLabel: pot.title,
    meta: { entryId: opts.entryId, decision: opts.decision, status },
    severity: opts.decision === "dispute" ? "warning" : "info",
  });

  // A dispute is the one thing on this screen somebody has to go and look at.
  if (opts.decision === "dispute") {
    await notifyChurchManagers({
      churchId: church.id,
      title: `A contribution payment is disputed`,
      body: `${user.name || "Someone"} disputed a ${formatMoney(row.amount, church.currency)} payment on "${pot.title}": ${note}`,
      linkUrl: `/contributions/${pot.id}`,
    }).catch((e) => console.error("[contributions] dispute notify failed", e));
  }

  await refreshGoalReached(church.id, pot.id);
  refresh(pot.id);
  refreshPublic(pot.slug);
  return ok({ id: opts.entryId, status });
}

/** Withdraw your own vote, so a mis-tap does not need somebody else to fix it. */
export async function withdrawVote(entryId: string): Promise<ActionResult> {
  const { church, user } = await requireChurch();
  const [row] = await db
    .select({
      contributionId: contributionEntry.contributionId,
    })
    .from(contributionEntry)
    .where(
      and(eq(contributionEntry.id, entryId), eq(contributionEntry.churchId, church.id)),
    )
    .limit(1);
  if (!row) return fail("That payment no longer exists.");

  const guard = await guardPot(row.contributionId);
  if (!guard) return fail("You can't change this collection.");
  const pot = await loadPot(church.id, row.contributionId);
  if (!pot) return fail("That collection no longer exists.");

  await db
    .delete(contributionApproval)
    .where(
      and(
        eq(contributionApproval.entryId, entryId),
        eq(contributionApproval.userId, user.id),
      ),
    );
  await recomputeEntry(entryId, pot.confirmationsRequired);

  await audit({
    churchId: church.id,
    action: "contributions.payment.update",
    summary: `Withdrew their confirmation on a payment in "${pot.title}"`,
    targetType: "contribution",
    targetId: pot.id,
    targetLabel: pot.title,
    meta: { entryId },
  });

  await refreshGoalReached(church.id, pot.id);
  refresh(pot.id);
  refreshPublic(pot.slug);
  return ok({ id: entryId });
}

/**
 * Settle a claim as not a real payment.
 *
 * Kept, never deleted, and never counted. Somebody reported a transfer that
 * never arrived; the honest record is that they said so and it was checked, not
 * a gap where a row used to be.
 */
export async function rejectEntry(opts: {
  entryId: string;
  reason: string;
}): Promise<ActionResult> {
  const reason = opts.reason?.trim();
  if (!reason) return fail("Say why it isn't being counted.");

  const { church } = await requireChurch();
  const [row] = await db
    .select({
      contributionId: contributionEntry.contributionId,
      amount: contributionEntry.amount,
    })
    .from(contributionEntry)
    .where(
      and(
        eq(contributionEntry.id, opts.entryId),
        eq(contributionEntry.churchId, church.id),
      ),
    )
    .limit(1);
  if (!row) return fail("That payment no longer exists.");

  const guard = await guardPot(row.contributionId);
  if (!guard) return fail("You can't change this collection.");
  const pot = await loadPot(church.id, row.contributionId);
  if (!pot) return fail("That collection no longer exists.");

  await db
    .update(contributionEntry)
    .set({
      status: "rejected",
      resolutionNote: reason.slice(0, 500),
      confirmedAt: null,
    })
    .where(eq(contributionEntry.id, opts.entryId));

  await audit({
    churchId: church.id,
    action: "contributions.payment.reject",
    summary: `Marked a ${formatMoney(row.amount, church.currency)} payment on "${pot.title}" as not counted — ${reason}`,
    targetType: "contribution",
    targetId: pot.id,
    targetLabel: pot.title,
    meta: { entryId: opts.entryId },
    severity: "warning",
  });

  await refreshGoalReached(church.id, pot.id);
  refresh(pot.id);
  refreshPublic(pot.slug);
  return ok({ id: opts.entryId });
}

/** Put a rejected claim back into the normal flow. */
export async function reopenEntry(entryId: string): Promise<ActionResult> {
  const { church } = await requireChurch();
  const [row] = await db
    .select({ contributionId: contributionEntry.contributionId })
    .from(contributionEntry)
    .where(
      and(eq(contributionEntry.id, entryId), eq(contributionEntry.churchId, church.id)),
    )
    .limit(1);
  if (!row) return fail("That payment no longer exists.");

  const guard = await guardPot(row.contributionId);
  if (!guard) return fail("You can't change this collection.");
  const pot = await loadPot(church.id, row.contributionId);
  if (!pot) return fail("That collection no longer exists.");

  await db
    .update(contributionEntry)
    .set({ resolutionNote: null })
    .where(eq(contributionEntry.id, entryId));
  await recomputeEntry(entryId, pot.confirmationsRequired, { clearRejection: true });

  await audit({
    churchId: church.id,
    action: "contributions.payment.update",
    summary: `Reopened a payment on "${pot.title}"`,
    targetType: "contribution",
    targetId: pot.id,
    targetLabel: pot.title,
    meta: { entryId },
  });

  await refreshGoalReached(church.id, pot.id);
  refresh(pot.id);
  refreshPublic(pot.slug);
  return ok({ id: entryId });
}

/* ============================================================
 * Money out
 * ========================================================== */

const payoutSchema = z.object({
  id: z.string().uuid().optional(),
  contributionId: z.string().uuid(),
  kind: z.enum(["handover", "expense", "withdrawal", "refund"]),
  amount: positiveMoney,
  paidOn: isoDate,
  payee: z.preprocess(emptyToNull, z.string().trim().max(160).nullable()),
  purpose: z.preprocess(emptyToNull, z.string().trim().max(400).nullable()),
  method: z.preprocess(emptyToNull, z.enum(METHODS).nullable()),
  reference: z.preprocess(emptyToNull, z.string().trim().max(120).nullable()),
  proofMediaId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  /** Post a hand-over into the church's books as income, in this account. */
  financeAccountId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
});

export type PayoutInput = z.input<typeof payoutSchema>;

export async function savePayout(input: PayoutInput): Promise<ActionResult> {
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Please check the form.");
  const d = parsed.data;

  const guard = await guardPot(d.contributionId);
  if (!guard) return fail("You can't record payments out on this collection.");
  const pot = await loadPot(guard.church.id, d.contributionId);
  if (!pot) return fail("That collection no longer exists.");

  if (d.financeAccountId && d.kind !== "handover")
    return fail(
      "Only money handed to the church goes into Finance — the rest never reaches the church's books.",
    );
  if (d.financeAccountId) {
    const [acct] = await db
      .select({ id: financeAccount.id })
      .from(financeAccount)
      .where(
        and(
          eq(financeAccount.id, d.financeAccountId),
          eq(financeAccount.churchId, guard.church.id),
        ),
      )
      .limit(1);
    if (!acct) return fail("That account doesn't exist.");
    if (!(await can("finance.manage")))
      return fail("You don't have permission to post into Finance.");
  }

  /*
   * You cannot pay out money the collection does not have.
   *
   * Confirmed in, minus everything already approved or waiting for approval.
   * Counting the pending ones is the point: two people each raising a payout
   * for the whole balance would otherwise both pass this check and the second
   * would overdraw a pot that holds cash in somebody's hand.
   */
  const available = await availableBalance(d.contributionId, d.id);
  if (d.amount > available)
    return fail(
      `That's more than the collection is holding. Available: ${formatMoney(available, guard.church.currency)}.`,
    );

  const proofMediaId = await claimProof(guard.church.id, d.proofMediaId);

  if (d.id) {
    const [before] = await db
      .select()
      .from(contributionPayout)
      .where(
        and(
          eq(contributionPayout.id, d.id),
          eq(contributionPayout.contributionId, d.contributionId),
        ),
      )
      .limit(1);
    if (!before) return fail("That payment out no longer exists.");
    if (before.status === "approved")
      return fail(
        "This has been approved and posted. Delete it and record a correction instead, so the change is on the record.",
      );

    await db
      .update(contributionPayout)
      .set({
        kind: d.kind,
        amount: d.amount,
        paidOn: d.paidOn,
        payee: d.payee,
        purpose: d.purpose,
        method: d.method,
        reference: d.reference,
        proofMediaId: proofMediaId ?? before.proofMediaId,
      })
      .where(eq(contributionPayout.id, d.id));

    // Same reasoning as an entry: approvals were given for an amount.
    if (before.amount !== d.amount) {
      await db
        .delete(contributionApproval)
        .where(eq(contributionApproval.payoutId, d.id));
    }
    await recomputePayout(d.id, pot.payoutApprovalsRequired, {
      financeAccountId: d.financeAccountId,
      churchId: guard.church.id,
      userId: guard.user.id,
      potTitle: pot.title,
    });

    await audit({
      churchId: guard.church.id,
      action: "contributions.payout.update",
      summary: `Edited a ${formatMoney(d.amount, guard.church.currency)} payment out of "${pot.title}"`,
      targetType: "contribution",
      targetId: pot.id,
      targetLabel: pot.title,
      meta: { payoutId: d.id },
      severity: "notice",
    });

    refresh(pot.id);
    refreshPublic(pot.slug);
    return ok({ id: d.id });
  }

  const [created] = await db
    .insert(contributionPayout)
    .values({
      contributionId: d.contributionId,
      churchId: guard.church.id,
      kind: d.kind,
      amount: d.amount,
      paidOn: d.paidOn,
      payee: d.payee,
      purpose: d.purpose,
      method: d.method,
      reference: d.reference,
      proofMediaId,
      status: "pending",
      recordedBy: guard.user.id,
    })
    .returning({ id: contributionPayout.id });
  if (!created) return fail("Could not record that.");

  // The person recording it counts as one approval, exactly as with an entry.
  await db.insert(contributionApproval).values({
    churchId: guard.church.id,
    payoutId: created.id,
    decision: "confirm",
    userId: guard.user.id,
    actorName: guard.user.name || guard.user.email,
    note: "Recorded this payment out",
  });
  const status = await recomputePayout(created.id, pot.payoutApprovalsRequired, {
    financeAccountId: d.financeAccountId,
    churchId: guard.church.id,
    userId: guard.user.id,
    potTitle: pot.title,
  });

  await audit({
    churchId: guard.church.id,
    action: "contributions.payout.create",
    summary: `Recorded ${formatMoney(d.amount, guard.church.currency)} out of "${pot.title}"${status === "pending" ? ` — waiting for ${pot.payoutApprovalsRequired} approvals` : ""}`,
    targetType: "contribution",
    targetId: pot.id,
    targetLabel: pot.title,
    meta: { payoutId: created.id, kind: d.kind, status },
    severity: "notice",
  });

  // Money leaving is what the rest of the team wants to hear about.
  if (status === "pending") {
    await notifyChurchManagers({
      churchId: guard.church.id,
      title: "A contribution payout needs approval",
      body: `${formatMoney(d.amount, guard.church.currency)} out of "${pot.title}"${d.purpose ? ` — ${d.purpose}` : ""}. It needs ${pot.payoutApprovalsRequired} people to approve it.`,
      linkUrl: `/contributions/${pot.id}`,
    }).catch((e) => console.error("[contributions] payout notify failed", e));
  }

  refresh(pot.id);
  refreshPublic(pot.slug);
  return ok({ id: created.id });
}

export async function voteOnPayout(opts: {
  payoutId: string;
  decision: "confirm" | "dispute";
  note?: string | null;
  /** Where to post it in Finance, if this approval is the one that completes it. */
  financeAccountId?: string | null;
}): Promise<ActionResult<{ status: string }>> {
  const { church, user } = await requireChurch();
  const [row] = await db
    .select({
      contributionId: contributionPayout.contributionId,
      amount: contributionPayout.amount,
      status: contributionPayout.status,
    })
    .from(contributionPayout)
    .where(
      and(
        eq(contributionPayout.id, opts.payoutId),
        eq(contributionPayout.churchId, church.id),
      ),
    )
    .limit(1);
  if (!row) return fail("That payment out no longer exists.");
  if (row.status === "approved") return fail("That has already been approved.");

  const guard = await guardPot(row.contributionId);
  if (!guard) return fail("You can't approve payments out on this collection.");
  const pot = await loadPot(church.id, row.contributionId);
  if (!pot) return fail("That collection no longer exists.");

  if (opts.decision === "dispute" && !opts.note?.trim())
    return fail("Say what the objection is.");
  const note = opts.note?.trim().slice(0, 500) || null;

  await db
    .insert(contributionApproval)
    .values({
      churchId: church.id,
      payoutId: opts.payoutId,
      decision: opts.decision,
      userId: user.id,
      actorName: user.name || user.email,
      note,
    })
    // Partial index again — see the note on the entry upsert above.
    .onConflictDoUpdate({
      target: [contributionApproval.payoutId, contributionApproval.userId],
      targetWhere: sql`${contributionApproval.payoutId} is not null and ${contributionApproval.userId} is not null`,
      set: { decision: opts.decision, note, createdAt: new Date() },
    });

  const status = await recomputePayout(opts.payoutId, pot.payoutApprovalsRequired, {
    financeAccountId: opts.financeAccountId ?? null,
    churchId: church.id,
    userId: user.id,
    potTitle: pot.title,
    objectionNote: opts.decision === "dispute" ? note : undefined,
  });

  await audit({
    churchId: church.id,
    action:
      opts.decision === "confirm"
        ? "contributions.payout.approve"
        : "contributions.payout.dispute",
    summary:
      opts.decision === "confirm"
        ? `Approved ${formatMoney(row.amount, church.currency)} out of "${pot.title}"${status === "approved" ? " — now fully approved" : ""}`
        : `Objected to ${formatMoney(row.amount, church.currency)} out of "${pot.title}" — ${note}`,
    targetType: "contribution",
    targetId: pot.id,
    targetLabel: pot.title,
    meta: { payoutId: opts.payoutId, decision: opts.decision, status },
    severity: opts.decision === "dispute" ? "warning" : "notice",
  });

  refresh(pot.id);
  refreshPublic(pot.slug);
  return ok({ id: opts.payoutId, status });
}

export async function deletePayout(id: string): Promise<ActionResult> {
  const { church } = await requireChurch();
  const [row] = await db
    .select()
    .from(contributionPayout)
    .where(
      and(eq(contributionPayout.id, id), eq(contributionPayout.churchId, church.id)),
    )
    .limit(1);
  if (!row) return fail("That payment out no longer exists.");

  const guard = await guardPot(row.contributionId);
  if (!guard) return fail("You can't change this collection.");
  const pot = await loadPot(church.id, row.contributionId);
  if (!pot) return fail("That collection no longer exists.");

  /*
   * Removing a hand-over removes its ledger row too.
   *
   * The income only exists because the money arrived; if the hand-over did not
   * happen, the church's books must not keep money nobody gave. The reverse is
   * not true — deleting the ledger row by hand leaves this record alone, which
   * is why the foreign key is set-null rather than a cascade.
   */
  if (row.financeTransactionId) {
    if (!(await can("finance.manage")))
      return fail(
        "This was posted into Finance, so it needs somebody with finance permission to remove.",
      );
    await db
      .delete(financeTransaction)
      .where(
        and(
          eq(financeTransaction.id, row.financeTransactionId),
          eq(financeTransaction.churchId, church.id),
        ),
      );
  }

  if (row.proofMediaId) await deleteProofFile(church.id, row.proofMediaId);
  await db.delete(contributionPayout).where(eq(contributionPayout.id, id));

  await audit({
    churchId: church.id,
    action: "contributions.payout.delete",
    summary: `Deleted a ${formatMoney(row.amount, church.currency)} payment out of "${pot.title}"${row.financeTransactionId ? ", and its Finance entry" : ""}`,
    targetType: "contribution",
    targetId: pot.id,
    targetLabel: pot.title,
    meta: { payoutId: id, amount: row.amount },
    severity: "warning",
  });

  refresh(pot.id);
  refreshPublic(pot.slug);
  return ok({ id });
}

/* ============================================================
 * Matching people to the register
 * ========================================================== */

export async function acceptMatch(opts: {
  contributorIds: string[];
  memberId: string;
}): Promise<ActionResult<{ linked: number; folded: number }>> {
  const { church } = await requireChurch();
  if (!(await can("contributions.manage")) || !(await can("members.view")))
    return fail("You don't have permission to link people to the register.");

  const result = await linkContributorsToMember({
    churchId: church.id,
    contributorIds: opts.contributorIds.slice(0, 200),
    memberId: opts.memberId,
  });
  if (result.linked === 0 && result.folded === 0)
    return fail("Nothing to link — those rows may already have been matched.");

  const [m] = await db
    .select({ firstName: member.firstName, lastName: member.lastName })
    .from(member)
    .where(eq(member.id, opts.memberId))
    .limit(1);
  const name = m ? [m.firstName, m.lastName].filter(Boolean).join(" ") : "a member";

  await audit({
    churchId: church.id,
    action: "contributions.person.link",
    summary: `Linked ${result.linked + result.folded} contribution ${result.linked + result.folded === 1 ? "record" : "records"} to ${name}${result.folded ? `, merging ${result.folded} duplicate ${result.folded === 1 ? "entry" : "entries"}` : ""}`,
    targetType: "member",
    targetId: opts.memberId,
    targetLabel: name,
    meta: result,
    severity: "notice",
  });

  refresh();
  return ok({ linked: result.linked, folded: result.folded });
}

export async function addToRegister(opts: {
  contributorIds: string[];
  firstName?: string;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
}): Promise<ActionResult<{ memberId: string }>> {
  const { church, user } = await requireChurch();
  if (!(await can("contributions.manage")) || !(await can("members.manage")))
    return fail("You don't have permission to add people to the register.");

  // The plan's member ceiling applies here as anywhere else — a side door into
  // the register would be a side door around the limit.
  const limit = await memberLimitStatus(church.id);
  if (limit.atLimit)
    return fail(
      `Your plan allows ${limit.limit} members and you have ${limit.used}. Upgrade to add more.`,
    );

  const result = await createMemberFromContributor({
    churchId: church.id,
    contributorIds: opts.contributorIds.slice(0, 200),
    firstName: opts.firstName,
    lastName: opts.lastName,
    phone: opts.phone,
    email: opts.email,
    createdBy: user.id,
  });
  if (!result) return fail("Could not add that person to the register.");

  await audit({
    churchId: church.id,
    action: "contributions.person.register",
    summary: `Added ${opts.firstName ?? "a contributor"} to the members register from a contribution, linking ${result.linked.linked + result.linked.folded} ${result.linked.linked + result.linked.folded === 1 ? "record" : "records"}`,
    targetType: "member",
    targetId: result.memberId,
    targetLabel: opts.firstName ?? null,
    meta: result.linked,
    severity: "notice",
  });

  refresh();
  revalidatePath("/members");
  return ok({ memberId: result.memberId });
}

export async function dismissMatch(
  contributorIds: string[],
): Promise<ActionResult<{ count: number }>> {
  const { church } = await requireChurch();
  if (!(await can("contributions.manage")))
    return fail("You don't have permission to do that.");
  const count = await dismissMatches({
    churchId: church.id,
    contributorIds: contributorIds.slice(0, 200),
  });
  refresh();
  return ok({ count });
}

export async function restoreMatch(
  contributorIds: string[],
): Promise<ActionResult<{ count: number }>> {
  const { church } = await requireChurch();
  if (!(await can("contributions.manage")))
    return fail("You don't have permission to do that.");
  const count = await restoreMatches({
    churchId: church.id,
    contributorIds: contributorIds.slice(0, 200),
  });
  refresh();
  return ok({ count });
}

/* ============================================================
 * Receipts
 * ========================================================== */

/**
 * Release a receipt file early, keeping the record that it existed.
 *
 * Storage is the recurring cost in this module, and a church that is full now
 * should not have to choose between deleting a payment and upgrading. What is
 * kept is `proofReleasedAt`, because "there was never a receipt" and "a receipt
 * was held and then released" are different facts.
 */
export async function releaseProof(opts: {
  entryId?: string;
  payoutId?: string;
}): Promise<ActionResult> {
  const { church } = await requireChurch();

  if (opts.entryId) {
    const [row] = await db
      .select({
        contributionId: contributionEntry.contributionId,
        proofMediaId: contributionEntry.proofMediaId,
      })
      .from(contributionEntry)
      .where(
        and(
          eq(contributionEntry.id, opts.entryId),
          eq(contributionEntry.churchId, church.id),
        ),
      )
      .limit(1);
    if (!row) return fail("That payment no longer exists.");
    const guard = await guardPot(row.contributionId);
    if (!guard) return fail("You can't change this collection.");
    if (!row.proofMediaId) return fail("There is no receipt to release.");

    await deleteProofFile(church.id, row.proofMediaId);
    await db
      .update(contributionEntry)
      .set({ proofMediaId: null, proofReleasedAt: new Date() })
      .where(eq(contributionEntry.id, opts.entryId));
    const pot = await loadPot(church.id, row.contributionId);
    await audit({
      churchId: church.id,
      action: "contributions.proof.release",
      summary: `Released the receipt file on a payment in "${pot?.title ?? "a collection"}" to free up storage`,
      targetType: "contribution",
      targetId: row.contributionId,
      targetLabel: pot?.title ?? null,
      meta: { entryId: opts.entryId },
    });
    refresh(row.contributionId);
    if (pot) refreshPublic(pot.slug);
    return ok({ id: opts.entryId });
  }

  if (opts.payoutId) {
    const [row] = await db
      .select({
        contributionId: contributionPayout.contributionId,
        proofMediaId: contributionPayout.proofMediaId,
      })
      .from(contributionPayout)
      .where(
        and(
          eq(contributionPayout.id, opts.payoutId),
          eq(contributionPayout.churchId, church.id),
        ),
      )
      .limit(1);
    if (!row) return fail("That payment out no longer exists.");
    const guard = await guardPot(row.contributionId);
    if (!guard) return fail("You can't change this collection.");
    if (!row.proofMediaId) return fail("There is no receipt to release.");

    await deleteProofFile(church.id, row.proofMediaId);
    await db
      .update(contributionPayout)
      .set({ proofMediaId: null, proofReleasedAt: new Date() })
      .where(eq(contributionPayout.id, opts.payoutId));
    const pot = await loadPot(church.id, row.contributionId);
    await audit({
      churchId: church.id,
      action: "contributions.proof.release",
      summary: `Released the receipt file on a payment out of "${pot?.title ?? "a collection"}" to free up storage`,
      targetType: "contribution",
      targetId: row.contributionId,
      targetLabel: pot?.title ?? null,
      meta: { payoutId: opts.payoutId },
    });
    refresh(row.contributionId);
    if (pot) refreshPublic(pot.slug);
    return ok({ id: opts.payoutId });
  }

  return fail("Nothing to release.");
}

/* ============================================================
 * Internals
 * ========================================================== */

/**
 * Find or create the roster row a payment belongs to.
 *
 * A payment can arrive naming somebody already on the list, naming a member, or
 * naming nobody the church has ever recorded — and the last of those is the
 * normal case on a Sunday. All three end up as one roster row, because a
 * payment with no person attached is a payment nobody can be shown.
 */
async function resolveContributor(opts: {
  churchId: string;
  contributionId: string;
  contributorId: string | null;
  name: string | null;
  memberId: string | null;
  phone: string | null;
}): Promise<string | null> {
  if (opts.contributorId) {
    const [row] = await db
      .select({ id: contributionContributor.id })
      .from(contributionContributor)
      .where(
        and(
          eq(contributionContributor.id, opts.contributorId),
          eq(contributionContributor.contributionId, opts.contributionId),
        ),
      )
      .limit(1);
    if (row) return row.id;
    return null;
  }

  if (opts.memberId) {
    const [existing] = await db
      .select({ id: contributionContributor.id })
      .from(contributionContributor)
      .where(
        and(
          eq(contributionContributor.contributionId, opts.contributionId),
          eq(contributionContributor.memberId, opts.memberId),
        ),
      )
      .limit(1);
    if (existing) return existing.id;

    const [m] = await db
      .select({ firstName: member.firstName, lastName: member.lastName, phone: member.phone, email: member.email })
      .from(member)
      .where(and(eq(member.id, opts.memberId), eq(member.churchId, opts.churchId)))
      .limit(1);
    if (!m) return null;
    const [created] = await db
      .insert(contributionContributor)
      .values({
        contributionId: opts.contributionId,
        churchId: opts.churchId,
        memberId: opts.memberId,
        name: [m.firstName, m.lastName].filter(Boolean).join(" "),
        phone: m.phone,
        email: m.email,
      })
      .returning({ id: contributionContributor.id });
    return created?.id ?? null;
  }

  const name = opts.name?.trim();
  if (!name) return null;

  // An existing row with the same tidied name is reused, so recording three
  // payments from "Sis. Grace Udo" does not create three Graces.
  const { nameKey } = await import("@/lib/contributions-shared");
  const key = nameKey(name);
  if (key) {
    const roster = await db
      .select({ id: contributionContributor.id, name: contributionContributor.name })
      .from(contributionContributor)
      .where(eq(contributionContributor.contributionId, opts.contributionId));
    const hit = roster.find((r) => nameKey(r.name) === key);
    if (hit) return hit.id;
  }

  const [created] = await db
    .insert(contributionContributor)
    .values({
      contributionId: opts.contributionId,
      churchId: opts.churchId,
      name: name.slice(0, 160),
      phone: opts.phone,
    })
    .returning({ id: contributionContributor.id });
  return created?.id ?? null;
}

/**
 * Check a media id really is this church's unattached receipt before pinning a
 * row to it.
 *
 * The id arrives from the browser, and without this a crafted request could
 * point an entry at another church's file — or at the same receipt as somebody
 * else's payment, so releasing one would blank the other.
 */
async function claimProof(
  churchId: string,
  mediaId: string | null,
): Promise<string | null> {
  if (!mediaId) return null;
  const [row] = await db
    .select({ id: media.id })
    .from(media)
    .where(
      and(
        eq(media.id, mediaId),
        eq(media.churchId, churchId),
        eq(media.kind, "receipt"),
      ),
    )
    .limit(1);
  if (!row) return null;

  const [usedByEntry] = await db
    .select({ id: contributionEntry.id })
    .from(contributionEntry)
    .where(eq(contributionEntry.proofMediaId, mediaId))
    .limit(1);
  if (usedByEntry) return null;
  const [usedByPayout] = await db
    .select({ id: contributionPayout.id })
    .from(contributionPayout)
    .where(eq(contributionPayout.proofMediaId, mediaId))
    .limit(1);
  if (usedByPayout) return null;

  return row.id;
}

/** Remove a receipt's file and its media row. Never throws. */
async function deleteProofFile(churchId: string, mediaId: string): Promise<void> {
  const [row] = await db
    .select({
      id: media.id,
      provider: media.provider,
      publicId: media.publicId,
      resourceType: media.resourceType,
    })
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.churchId, churchId)))
    .limit(1);
  if (!row) return;
  if (row.provider === "cloudinary" && row.publicId) {
    // destroyFromCloudinary catches internally and returns a boolean; a file
    // left behind at the provider is a storage figure that reads slightly high,
    // not a broken record, and must not stop the row being cleared.
    await destroyFromCloudinary(
      row.publicId,
      (row.resourceType as ResourceType) || "image",
    );
  }
  await db.delete(media).where(eq(media.id, row.id));
}

/** Every receipt on a collection, for when the collection itself is deleted. */
async function releaseProofsFor(churchId: string, potId: string): Promise<void> {
  const [entries, payouts] = await Promise.all([
    db
      .select({ proofMediaId: contributionEntry.proofMediaId })
      .from(contributionEntry)
      .where(eq(contributionEntry.contributionId, potId)),
    db
      .select({ proofMediaId: contributionPayout.proofMediaId })
      .from(contributionPayout)
      .where(eq(contributionPayout.contributionId, potId)),
  ]);
  const ids = [...entries, ...payouts]
    .map((r) => r.proofMediaId)
    .filter((x): x is string => x !== null);
  for (const id of ids) await deleteProofFile(churchId, id);
}

/**
 * Re-derive and store an entry's status from the votes on it.
 *
 * The votes are counted here and the rule is applied in
 * `deriveEntryStatus`, which is pure and unit-tested. Splitting it that way is
 * deliberate: the counting needs a database and the rule does not, and the rule
 * is the part that decides whether money is real.
 */
async function recomputeEntry(
  entryId: string,
  required: number,
  opts: { clearRejection?: boolean; resolutionNote?: string | null } = {},
): Promise<EntryStatus> {
  const [row] = await db
    .select({ status: contributionEntry.status })
    .from(contributionEntry)
    .where(eq(contributionEntry.id, entryId))
    .limit(1);
  const wasRejected = row?.status === "rejected" && !opts.clearRejection;

  const votes = await db
    .select({
      decision: contributionApproval.decision,
      n: sql<string>`count(*)`,
    })
    .from(contributionApproval)
    .where(eq(contributionApproval.entryId, entryId))
    .groupBy(contributionApproval.decision);

  const confirmations = Number(
    votes.find((v) => v.decision === "confirm")?.n ?? 0,
  );
  const disputes = Number(votes.find((v) => v.decision === "dispute")?.n ?? 0);

  const status = deriveEntryStatus({
    rejected: wasRejected,
    confirmations,
    disputes,
    required,
  });

  await db
    .update(contributionEntry)
    .set({
      status,
      confirmedAt: status === "confirmed" ? new Date() : null,
      ...(opts.resolutionNote !== undefined
        ? { resolutionNote: opts.resolutionNote }
        : {}),
    })
    .where(eq(contributionEntry.id, entryId));

  return status;
}

/**
 * The same for a payout — and, when the last approval lands, the one place
 * money crosses into the church's books.
 */
async function recomputePayout(
  payoutId: string,
  required: number,
  ctx: {
    churchId: string;
    userId: string;
    potTitle: string;
    financeAccountId?: string | null;
    objectionNote?: string | null;
  },
): Promise<PayoutStatusValue> {
  const votes = await db
    .select({ decision: contributionApproval.decision, n: sql<string>`count(*)` })
    .from(contributionApproval)
    .where(eq(contributionApproval.payoutId, payoutId))
    .groupBy(contributionApproval.decision);

  const approvals = Number(votes.find((v) => v.decision === "confirm")?.n ?? 0);
  const disputes = Number(votes.find((v) => v.decision === "dispute")?.n ?? 0);

  const [row] = await db
    .select()
    .from(contributionPayout)
    .where(eq(contributionPayout.id, payoutId))
    .limit(1);
  if (!row) return "pending";

  const status = derivePayoutStatus({
    rejected: row.status === "rejected",
    approvals,
    disputes,
    required,
  });

  let financeTransactionId = row.financeTransactionId;

  // Post into Finance only on the transition into "approved", and only for a
  // hand-over. Guarding on the transition is what stops a second approval
  // writing a second income row for the same money.
  if (
    status === "approved" &&
    row.status !== "approved" &&
    row.kind === "handover" &&
    ctx.financeAccountId &&
    !financeTransactionId
  ) {
    financeTransactionId = await postHandoverToFinance({
      churchId: ctx.churchId,
      accountId: ctx.financeAccountId,
      amount: row.amount,
      date: row.paidOn,
      party: row.payee,
      reference: row.reference,
      potTitle: ctx.potTitle,
      userId: ctx.userId,
    });
  }

  await db
    .update(contributionPayout)
    .set({
      status,
      approvedAt: status === "approved" ? (row.approvedAt ?? new Date()) : null,
      financeTransactionId,
      ...(ctx.objectionNote !== undefined
        ? { resolutionNote: ctx.objectionNote }
        : {}),
    })
    .where(eq(contributionPayout.id, payoutId));

  return status;
}

type PayoutStatusValue = "pending" | "approved" | "rejected";

/**
 * Write a hand-over into the church's books as income.
 *
 * One row, one direction. Nothing in Finance ever writes back here — the
 * collection says what the group collected, Finance says what the church holds,
 * and the hand-over is the single point where one becomes the other. The
 * category is created if it is missing, because a hand-over filed as
 * "Uncategorised" is money a treasurer cannot explain.
 */
async function postHandoverToFinance(opts: {
  churchId: string;
  accountId: string;
  amount: number;
  date: string;
  party: string | null;
  reference: string | null;
  potTitle: string;
  userId: string;
}): Promise<string | null> {
  const CATEGORY = "Group contributions";
  const [existing] = await db
    .select({ id: financeCategory.id })
    .from(financeCategory)
    .where(
      and(
        eq(financeCategory.churchId, opts.churchId),
        eq(financeCategory.kind, "income"),
        eq(financeCategory.name, CATEGORY),
      ),
    )
    .limit(1);

  let categoryId = existing?.id ?? null;
  if (!categoryId) {
    const [created] = await db
      .insert(financeCategory)
      .values({ churchId: opts.churchId, name: CATEGORY, kind: "income" })
      .onConflictDoNothing()
      .returning({ id: financeCategory.id });
    categoryId = created?.id ?? null;
    if (!categoryId) {
      // Lost a race with a concurrent insert — read back the winner.
      const [after] = await db
        .select({ id: financeCategory.id })
        .from(financeCategory)
        .where(
          and(
            eq(financeCategory.churchId, opts.churchId),
            eq(financeCategory.kind, "income"),
            eq(financeCategory.name, CATEGORY),
          ),
        )
        .limit(1);
      categoryId = after?.id ?? null;
    }
  }

  const [txn] = await db
    .insert(financeTransaction)
    .values({
      churchId: opts.churchId,
      kind: "income",
      amount: opts.amount,
      date: opts.date,
      accountId: opts.accountId,
      categoryId,
      party: opts.party,
      reference: opts.reference,
      note: `Handed over from the group collection "${opts.potTitle}"`,
      recordedBy: opts.userId,
    })
    .returning({ id: financeTransaction.id });

  revalidatePath("/finance");
  return txn?.id ?? null;
}

/**
 * What a collection can still pay out: confirmed in, less everything already
 * approved or awaiting approval.
 *
 * `excludePayoutId` lets an edit measure itself against a balance that does not
 * include its own old amount — otherwise raising a payout by 500 would be
 * compared against a balance the payout itself had already spent.
 */
async function availableBalance(
  potId: string,
  excludePayoutId?: string,
): Promise<number> {
  const [inRow] = await db
    .select({ total: sql<string>`coalesce(sum(${contributionEntry.amount}), 0)` })
    .from(contributionEntry)
    .where(
      and(
        eq(contributionEntry.contributionId, potId),
        eq(contributionEntry.status, "confirmed"),
      ),
    );

  const outRows = await db
    .select({
      id: contributionPayout.id,
      amount: contributionPayout.amount,
      status: contributionPayout.status,
    })
    .from(contributionPayout)
    .where(eq(contributionPayout.contributionId, potId));

  const committed = outRows
    .filter((r) => r.id !== excludePayoutId)
    .filter((r) => r.status === "approved" || r.status === "pending")
    .reduce((a, r) => a + r.amount, 0);

  return Number(inRow?.total ?? 0) - committed;
}

/**
 * Decide, after anything that moves a figure, whether the goal is met — and
 * announce it once.
 *
 * Stored rather than computed on read so the celebration happens once and the
 * public page can say "reached on the 14th" rather than "currently above the
 * line". Cleared again if the figures fall back below, because a banner
 * claiming a goal that is no longer met is worse than no banner.
 */
async function refreshGoalReached(churchId: string, potId: string): Promise<void> {
  const [pot] = await db
    .select({
      id: contribution.id,
      title: contribution.title,
      targetAmount: contribution.targetAmount,
      perPersonAmount: contribution.perPersonAmount,
      goalReachedAt: contribution.goalReachedAt,
      status: contribution.status,
    })
    .from(contribution)
    .where(and(eq(contribution.id, potId), eq(contribution.churchId, churchId)))
    .limit(1);
  if (!pot) return;

  const [raisedRow] = await db
    .select({ total: sql<string>`coalesce(sum(${contributionEntry.amount}), 0)` })
    .from(contributionEntry)
    .where(
      and(
        eq(contributionEntry.contributionId, potId),
        eq(contributionEntry.status, "confirmed"),
      ),
    );
  const raised = Number(raisedRow?.total ?? 0);

  const roster = await db
    .select({ expectedAmount: contributionContributor.expectedAmount })
    .from(contributionContributor)
    .where(eq(contributionContributor.contributionId, potId));
  const expectedTotal = roster.reduce(
    (a, c) => a + (expectedFor(c.expectedAmount, pot.perPersonAmount) ?? 0),
    0,
  );

  const target = effectiveTarget({
    targetAmount: pot.targetAmount,
    perPersonAmount: pot.perPersonAmount,
    expectedTotal,
  });

  const reached = target !== null && target > 0 && raised >= target;

  if (reached && !pot.goalReachedAt) {
    await db
      .update(contribution)
      .set({ goalReachedAt: new Date() })
      .where(eq(contribution.id, potId));
    const [c] = await db
      .select({ currency: churchTable.currency })
      .from(churchTable)
      .where(eq(churchTable.id, churchId))
      .limit(1);
    await notifyChurchManagers({
      churchId,
      title: `Goal reached: ${pot.title}`,
      body: `"${pot.title}" has reached its goal of ${formatMoney(target, c?.currency ?? "NGN")}. ${formatMoney(raised, c?.currency ?? "NGN")} has come in.`,
      linkUrl: `/contributions/${potId}`,
    }).catch((e) => console.error("[contributions] goal notify failed", e));
    return;
  }

  if (!reached && pot.goalReachedAt) {
    await db
      .update(contribution)
      .set({ goalReachedAt: null })
      .where(eq(contribution.id, potId));
  }
}
