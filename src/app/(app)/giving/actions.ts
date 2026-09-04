"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { nextPledgeStatus } from "@/lib/pledge-status";
import { syncGivingToFinance } from "@/lib/finance-giving-sync";
import { giving, givingCategory, member, pledge, project } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { sendGivingReceipt } from "@/lib/giving-receipts";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const METHODS = [
  "cash",
  "transfer",
  "card",
  "cheque",
  "online",
  "other",
] as const;

const givingSchema = z.object({
  id: z.string().uuid().optional(),
  categoryId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  amount: z.preprocess(
    (v) => (typeof v === "string" ? Number(v.replace(/,/g, "")) : v),
    z
      .number({ message: "Enter an amount" })
      .positive("Amount must be greater than 0")
      .max(1_000_000_000_000),
  ),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  memberId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  giverName: z.preprocess(emptyToNull, z.string().trim().max(160).nullable()),
  method: z.preprocess(emptyToNull, z.enum(METHODS).nullable()),
  note: z.preprocess(emptyToNull, z.string().trim().max(500).nullable()),
  // Fundraising: a gift toward a project, and/or a payment against a pledge.
  projectId: z.preprocess(emptyToNull, z.string().uuid().nullable()).default(null),
  pledgeId: z.preprocess(emptyToNull, z.string().uuid().nullable()).default(null),
  // Send an acknowledgement + blessing to the giver (only for a new gift tied
  // to a member with contact details; also gated by the church's receipt setting).
  sendReceipt: z.preprocess((v) => v === true || v === "true", z.boolean()).default(false),
});

export type GivingInput = z.input<typeof givingSchema>;

export async function recordGiving(input: GivingInput): Promise<ActionResult> {
  const parsed = givingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const d = parsed.data;
  const { church, user } = await requireChurch();
  if (!(await can("giving.manage")))
    return { ok: false, error: "You don't have permission to manage giving." };

  // Category, if given, must belong to this church.
  let categoryName: string | null = null;
  if (d.categoryId) {
    const [cat] = await db
      .select({ id: givingCategory.id, name: givingCategory.name })
      .from(givingCategory)
      .where(
        and(
          eq(givingCategory.id, d.categoryId),
          eq(givingCategory.churchId, church.id),
        ),
      )
      .limit(1);
    if (!cat) return { ok: false, error: "That category doesn't exist." };
    categoryName = cat.name;
  }

  // Member, if given, must belong to this church.
  let giver: { firstName: string; phone: string | null; email: string | null } | null =
    null;
  if (d.memberId) {
    const [m] = await db
      .select({
        id: member.id,
        firstName: member.firstName,
        phone: member.phone,
        email: member.email,
      })
      .from(member)
      .where(and(eq(member.id, d.memberId), eq(member.churchId, church.id)))
      .limit(1);
    if (!m) return { ok: false, error: "That giver isn't in your congregation." };
    giver = { firstName: m.firstName, phone: m.phone, email: m.email };
  }

  // Pledge, if given, must belong to this church. A pledge payment implies its
  // project, so derive projectId from the pledge when not supplied explicitly.
  let projectId = d.projectId;
  if (d.pledgeId) {
    const [pl] = await db
      .select({ id: pledge.id, projectId: pledge.projectId })
      .from(pledge)
      .where(and(eq(pledge.id, d.pledgeId), eq(pledge.churchId, church.id)))
      .limit(1);
    if (!pl) return { ok: false, error: "That pledge doesn't exist." };
    projectId = pl.projectId;
  }
  // Project, if given (directly or via pledge), must belong to this church.
  if (projectId) {
    const [pr] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.churchId, church.id)))
      .limit(1);
    if (!pr) return { ok: false, error: "That project doesn't exist." };
  }

  const fields = {
    categoryId: d.categoryId,
    amount: d.amount,
    date: d.date,
    memberId: d.memberId,
    giverName: d.giverName,
    method: d.method,
    note: d.note,
    projectId,
    pledgeId: d.pledgeId,
  };

  try {
    if (d.id) {
      // Editing an existing record never changes its project/pledge link (those
      // are set when a payment is recorded from a project). This keeps edits
      // from the general giving list from silently unlinking a pledge payment.
      const { projectId: _p, pledgeId: _pl, ...editable } = fields;
      void _p;
      void _pl;
      const [row] = await db
        .update(giving)
        .set(editable)
        .where(and(eq(giving.id, d.id), eq(giving.churchId, church.id)))
        .returning({
          id: giving.id,
          projectId: giving.projectId,
          pledgeId: giving.pledgeId,
        });
      if (!row) return { ok: false, error: "Giving record not found." };
      // The amount may have moved in either direction, so the pledge it pays
      // can now be finished or unfinished. The link itself is untouched above,
      // so read it back from the row rather than the submitted fields.
      if (row.pledgeId) await syncPledgeStatus(church.id, row.pledgeId);
      // Mirror the change into the category's fund, if it has one. The amount,
      // date or category may all have moved.
      await syncGivingToFinance(church.id, row.id);
      revalidatePath("/giving");
      revalidatePath("/dashboard");
      revalidatePath("/finance");
      if (row.projectId) revalidatePath(`/giving/projects/${row.projectId}`);
      return { ok: true, id: row.id };
    }

    const [row] = await db
      .insert(giving)
      .values({ churchId: church.id, ...fields, recordedBy: user.id })
      .returning({ id: giving.id });

    // Close the pledge if this payment finishes it (best-effort, never blocks).
    if (d.pledgeId) await syncPledgeStatus(church.id, d.pledgeId);

    // If this category has a fund account, the gift is mirrored into it as
    // income. Best-effort: the gift is saved either way.
    await syncGivingToFinance(church.id, row.id);

    // Thank the giver + speak a blessing, if requested and possible. The helper
    // re-checks the church's receipt setting and is best-effort (never throws).
    if (d.sendReceipt && giver) {
      await sendGivingReceipt({
        churchId: church.id,
        churchName: church.name,
        currency: church.currency,
        firstName: giver.firstName,
        phone: giver.phone,
        email: giver.email,
        amount: d.amount,
        categoryName,
        method: d.method,
        date: d.date,
      });
    }

    revalidatePath("/giving");
    revalidatePath("/dashboard");
    revalidatePath("/communication/history");
    revalidatePath("/finance");
    if (projectId) revalidatePath(`/giving/projects/${projectId}`);
    return { ok: true, id: row.id };
  } catch (e) {
    console.error("recordGiving failed", e);
    return { ok: false, error: "Could not save the giving record." };
  }
}

/**
 * Keep a pledge's status in step with what has actually been paid against it,
 * after a payment is recorded, edited or removed.
 *
 * Moves only between "active" and "completed" — a cancelled pledge is left
 * alone (see nextPledgeStatus). Best-effort: the payment is already saved, and
 * failing to relabel the pledge must never undo that.
 */
async function syncPledgeStatus(churchId: string, pledgeId: string): Promise<void> {
  try {
    const [pl] = await db
      .select({ amount: pledge.amount, status: pledge.status })
      .from(pledge)
      .where(and(eq(pledge.id, pledgeId), eq(pledge.churchId, churchId)))
      .limit(1);
    if (!pl) return;

    const [sum] = await db
      .select({ paid: sql<number>`coalesce(sum(${giving.amount}), 0)` })
      .from(giving)
      .where(and(eq(giving.pledgeId, pledgeId), eq(giving.churchId, churchId)));

    const next = nextPledgeStatus(
      pl.status,
      Number(pl.amount),
      Number(sum?.paid ?? 0),
    );
    if (!next) return;

    await db
      .update(pledge)
      .set({ status: next })
      .where(and(eq(pledge.id, pledgeId), eq(pledge.churchId, churchId)));
  } catch (e) {
    console.error("syncPledgeStatus failed", e);
  }
}

export async function deleteGiving(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  const { church } = await requireChurch();
  if (!(await can("giving.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  try {
    const [row] = await db
      .delete(giving)
      .where(and(eq(giving.id, id), eq(giving.churchId, church.id)))
      .returning({
        id: giving.id,
        projectId: giving.projectId,
        pledgeId: giving.pledgeId,
      });
    if (!row) return { ok: false, error: "Giving record not found." };
    // Taking a payment away can leave a pledge marked complete that no longer
    // is, which would drop it out of the outstanding report for good.
    if (row.pledgeId) await syncPledgeStatus(church.id, row.pledgeId);
    // The fund's mirror row goes with it, by the foreign key's cascade — it
    // only ever existed as this gift's reflection, and leaving it would show
    // money in the fund that nobody gave.
    revalidatePath("/finance");
    // A gift feeds the dashboard totals and its project's progress too, so
    // refresh the same views recording one does — otherwise they keep showing
    // money that is no longer there.
    revalidatePath("/giving");
    revalidatePath("/dashboard");
    if (row.projectId) revalidatePath(`/giving/projects/${row.projectId}`);
    return { ok: true, id: row.id };
  } catch (e) {
    console.error("deleteGiving failed", e);
    return { ok: false, error: "Could not delete the giving record." };
  }
}
