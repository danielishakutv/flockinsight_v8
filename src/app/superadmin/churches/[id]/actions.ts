"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";

import { resetChurch, restoreChurchAsNew, type ChurchBackup } from "@/lib/church-data";
import { recordAudit } from "@/lib/audit";
import { notifyChurchOfAdminAction } from "@/lib/admin-notify";
import { waiverEndDate } from "@/lib/trial";

import { requirePlatform } from "@/lib/platform-access";
export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Reset a church: clears its operational data (members, attendance, giving,
 * groups, follow-up, forms, devotionals, subscribers, events, media) but keeps
 * the account, team, roles, services, giving categories and settings.
 * Requires typing the exact church name to confirm. A backup should be taken
 * first (the UI forces this); the platform DB is also backed up daily.
 */
export async function resetChurchAction(
  id: string,
  confirmName: string,
): Promise<ActionResult> {
  const admin = await requirePlatform("platform.churches.manage");
  if (!z.string().min(1).safeParse(id).success)
    return { ok: false, error: "Invalid church." };

  const [c] = await db
    .select({ id: church.id, name: church.name })
    .from(church)
    .where(eq(church.id, id))
    .limit(1);
  if (!c) return { ok: false, error: "Church not found." };

  if (confirmName.trim() !== c.name.trim())
    return { ok: false, error: "The name you typed doesn't match. Nothing was changed." };

  await resetChurch(id);

  await notifyChurchOfAdminAction({
    churchId: id,
    title: "Your church data was reset",
    subject: "Your FlockInsight data has been reset",
    body:
      "At your request, we cleared this church's records — members, attendance, giving, groups, follow-up, forms, devotionals, subscribers, events and media. Your account, team, roles, services, giving categories and settings are untouched, so you can start recording again straight away.",
    linkUrl: "/dashboard",
    ctaLabel: "Open your dashboard",
  });

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "reset_church",
    summary: `Reset church data for "${c.name}" (kept account, team & settings)`,
    targetType: "church",
    targetId: id,
  });

  revalidatePath(`/superadmin/churches/${id}`);
  return { ok: true };
}

/**
 * Restore a backup as a BRAND-NEW church (never touches existing churches).
 */
export async function restoreChurchAction(
  backupJson: string,
): Promise<{ ok: true; churchId: string; name: string } | { ok: false; error: string }> {
  const admin = await requirePlatform("platform.churches.manage");

  let backup: ChurchBackup;
  try {
    backup = JSON.parse(backupJson) as ChurchBackup;
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }

  const res = await restoreChurchAsNew(backup);
  if (!res.ok) return res;

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "restore_church",
    summary: `Restored a backup into a new church "${res.name}"`,
    targetType: "church",
    targetId: res.churchId,
  });

  revalidatePath("/superadmin/churches");
  return res;
}

/**
 * Comp a church: waive payment so it doesn't need to pay to use the app.
 *
 * `months` is how long the comp lasts — 0 (or omitted) means no end date,
 * which is what every waiver granted before this existed is. The deadline is
 * stored and honoured on read (see computeStanding), so nothing has to run on
 * the day it expires for it to expire.
 */
export async function setPaymentWaived(
  id: string,
  waived: boolean,
  months: number = 0,
): Promise<ActionResult> {
  const admin = await requirePlatform("platform.churches.manage");
  const parsedMonths = z.number().int().min(0).max(120).safeParse(months);
  if (!parsedMonths.success)
    return { ok: false, error: "Choose how long the comp should last." };

  const [c] = await db
    .select({ name: church.name })
    .from(church)
    .where(eq(church.id, id))
    .limit(1);
  if (!c) return { ok: false, error: "Church not found." };

  const until = waived ? waiverEndDate(parsedMonths.data) : null;

  await db
    .update(church)
    .set({
      paymentWaived: waived,
      paymentWaivedUntil: until,
      // Back to the start of the ladder, so a renewed or extended comp warns
      // the church again before THIS one ends.
      waiverReminderStage: 0,
    })
    .where(eq(church.id, id));

  const untilWords = until
    ? ` This runs until ${until.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}, and we'll let you know before it ends.`
    : "";

  await notifyChurchOfAdminAction({
    churchId: id,
    title: waived ? "Your subscription is on us 🎁" : "Complimentary access ended",
    subject: waived
      ? "FlockInsight is free for your church"
      : "A change to your FlockInsight billing",
    body: waived
      ? `The FlockInsight team has waived payment for your church. You have full access to your plan at no cost, and you won't be asked to pay or be blocked when a trial ends.${untilWords}`
      : "The payment waiver on your church has been removed, so your account now follows the normal plan and billing rules again.",
    linkUrl: "/settings/billing",
    ctaLabel: "View billing",
  });

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "waive_payment",
    summary: waived
      ? `Waived payment for "${c.name}"${until ? ` until ${until.toISOString().slice(0, 10)}` : " with no end date"}`
      : `Un-waived payment for "${c.name}"`,
    targetType: "church",
    targetId: id,
  });

  revalidatePath(`/superadmin/churches/${id}`);
  return { ok: true };
}

/**
 * Mark (or unmark) a church as the demonstration church.
 *
 * AT MOST ONE, enforced in the same transaction that sets it: two demo
 * churches would both be wiped every two hours, and the second one would be
 * somebody's actual records.
 *
 * It also refuses a church with money on it. A church that has paid, or has a
 * wallet balance, is not a demo — and the cost of getting this wrong is its
 * data being deleted on a schedule, so the check belongs here as well as in
 * the cron that does the deleting.
 */
export async function setDemoChurch(
  id: string,
  isDemo: boolean,
): Promise<ActionResult> {
  const admin = await requirePlatform("platform.churches.manage");
  const [c] = await db
    .select({
      name: church.name,
      walletBalance: church.walletBalance,
      planRenewsAt: church.planRenewsAt,
    })
    .from(church)
    .where(eq(church.id, id))
    .limit(1);
  if (!c) return { ok: false, error: "Church not found." };

  if (isDemo) {
    const paid =
      Number(c.walletBalance) > 0 ||
      (c.planRenewsAt != null && c.planRenewsAt.getTime() > Date.now());
    if (paid)
      return {
        ok: false,
        error:
          "That church has a wallet balance or a paid plan, so it looks like a real one. The demo church is wiped every two hours — pick another.",
      };
  }

  await db.transaction(async (tx) => {
    if (isDemo) {
      // Clear any previous holder first, in the same transaction.
      await tx.update(church).set({ isDemo: false }).where(eq(church.isDemo, true));
    }
    await tx.update(church).set({ isDemo }).where(eq(church.id, id));
  });

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: isDemo ? "set_demo_church" : "unset_demo_church",
    summary: isDemo
      ? `Made "${c.name}" the demonstration church — its data will be wiped every 2 hours`
      : `"${c.name}" is no longer the demonstration church`,
    targetType: "church",
    targetId: id,
  });

  revalidatePath(`/superadmin/churches/${id}`);
  return { ok: true };
}

/** Extend a church's free trial by N weeks (from the later of now / current end). */
export async function extendTrial(id: string, weeks: number): Promise<ActionResult> {
  const admin = await requirePlatform("platform.churches.manage");
  const w = Math.max(1, Math.min(52, Math.round(weeks)));

  const [c] = await db
    .select({ name: church.name, trialEndsAt: church.trialEndsAt })
    .from(church)
    .where(eq(church.id, id))
    .limit(1);
  if (!c) return { ok: false, error: "Church not found." };

  const now = new Date();
  const base =
    c.trialEndsAt && new Date(c.trialEndsAt) > now ? new Date(c.trialEndsAt) : now;
  const newEnd = new Date(base);
  newEnd.setDate(newEnd.getDate() + w * 7);

  await db
    .update(church)
    .set({ trialEndsAt: newEnd, trialReminderStage: 0 })
    .where(eq(church.id, id));

  await notifyChurchOfAdminAction({
    churchId: id,
    title: "Your free trial was extended 🎉",
    subject: `Your FlockInsight trial now runs to ${newEnd.toDateString()}`,
    body: `Good news — the FlockInsight team has extended your free trial by ${w} week${w === 1 ? "" : "s"}. Everything stays open, and there is nothing you need to do.`,
    details: [
      { label: "Extended by", value: `${w} week${w === 1 ? "" : "s"}` },
      { label: "New trial end date", value: newEnd.toDateString() },
    ],
    linkUrl: "/settings/billing",
    ctaLabel: "View billing",
  });

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "extend_trial",
    summary: `Extended trial for "${c.name}" by ${w} week(s) → ${newEnd.toDateString()}`,
    targetType: "church",
    targetId: id,
  });

  revalidatePath(`/superadmin/churches/${id}`);
  return { ok: true };
}

/* ============================================================
 * Church networks
 * ========================================================== */

const parentSchema = z.object({
  churchId: z.string().min(1),
  parentChurchId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().nullable(),
  ),
});

/**
 * Point a church at its headquarters (or detach it), from the platform side.
 * Churches normally arrange this between themselves under Branches; this is
 * the operator's override for fixing a mistake or setting one up on request.
 */
export async function setChurchParent(
  input: z.input<typeof parentSchema>,
): Promise<ActionResult> {
  const admin = await requirePlatform("platform.churches.manage");
  const parsed = parentSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { churchId, parentChurchId } = parsed.data;

  if (parentChurchId === churchId)
    return { ok: false, error: "A church cannot be its own headquarters." };

  if (parentChurchId) {
    // Networks stay one level deep, so reporting has a single, obvious shape.
    const [parent] = await db
      .select({ id: church.id, parentChurchId: church.parentChurchId })
      .from(church)
      .where(eq(church.id, parentChurchId))
      .limit(1);
    if (!parent) return { ok: false, error: "That headquarters no longer exists." };
    if (parent.parentChurchId)
      return {
        ok: false,
        error: "That church is itself a branch — pick its headquarters instead.",
      };

    const [ownBranch] = await db
      .select({ id: church.id })
      .from(church)
      .where(eq(church.parentChurchId, churchId))
      .limit(1);
    if (ownBranch)
      return {
        ok: false,
        error: "This church already has branches, so it cannot become one.",
      };
  }

  await db
    .update(church)
    .set({ parentChurchId, ...(parentChurchId ? {} : { zone: null }) })
    .where(eq(church.id, churchId));

  await notifyChurchOfAdminAction({
    churchId,
    title: parentChurchId
      ? "Your church was linked to a headquarters"
      : "Your church was detached from its headquarters",
    subject: parentChurchId
      ? "Your church is now part of a network"
      : "Your church is no longer part of a network",
    body: parentChurchId
      ? "Your church has been linked to its headquarters as a branch. Your data, plan and logins are unchanged and stay yours — the link only lets your headquarters see reports across its branches."
      : "Your church has been detached from its headquarters. Your data, plan and logins are unchanged; your headquarters no longer sees your church in its branch reports.",
    linkUrl: "/branches",
    ctaLabel: "Open Branches",
  });

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: parentChurchId ? "church_linked_to_hq" : "church_unlinked_from_hq",
    summary: parentChurchId
      ? "Linked a church to a headquarters"
      : "Detached a church from its headquarters",
    targetType: "church",
    targetId: churchId,
  });

  revalidatePath(`/superadmin/churches/${churchId}`);
  revalidatePath("/superadmin/churches");
  return { ok: true };
}
