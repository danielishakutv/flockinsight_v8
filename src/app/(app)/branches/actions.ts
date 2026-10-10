"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { branchRequest, church, hqReportSetting } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { audit } from "@/lib/audit";
import { requireCan } from "@/lib/permissions";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { churchTeamEmails } from "@/lib/branches";
import {
  createBand,
  deleteBand,
  fileBranches,
  moveBand,
  renameBand,
} from "@/lib/branch-groups";
import { escapeHtml } from "@/lib/html-escape";

export type ActionResult = { ok: true } | { ok: false; error: string };

const BASE_URL = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

/* ============================================================
 * Inviting a church to become a branch
 * ========================================================== */

const inviteSchema = z.object({
  churchId: z.string().min(1),
  message: z.preprocess(emptyToNull, z.string().trim().max(500).nullable()),
});

/**
 * Ask another church to join this network. Nothing changes for them until
 * they accept — a headquarters cannot help itself to another church's data.
 */
export async function inviteBranch(
  input: z.input<typeof inviteSchema>,
): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("branches");
  if (gate) return gate;
  const { church: hq, user } = await requireChurch();
  await requireCan("settings.manage");

  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { churchId, message } = parsed.data;

  if (churchId === hq.id)
    return { ok: false, error: "A church can't be its own branch." };

  const [target] = await db
    .select({
      id: church.id,
      name: church.name,
      parentChurchId: church.parentChurchId,
    })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  if (!target) return { ok: false, error: "That church no longer exists." };
  if (target.parentChurchId)
    return { ok: false, error: "That church already belongs to a network." };
  // A headquarters that is itself a branch would make the reporting tree
  // ambiguous; keep networks one level deep.
  if (hq.parentChurchId)
    return {
      ok: false,
      error: "This church is already a branch, so it can't have branches of its own.",
    };

  const [existing] = await db
    .select({ id: branchRequest.id })
    .from(branchRequest)
    .where(
      and(
        eq(branchRequest.parentChurchId, hq.id),
        eq(branchRequest.childChurchId, churchId),
        eq(branchRequest.status, "pending"),
      ),
    )
    .limit(1);
  if (existing)
    return { ok: false, error: "You have already invited that church." };

  await db.insert(branchRequest).values({
    parentChurchId: hq.id,
    childChurchId: churchId,
    message,
    requestedBy: user.id,
  });

  // Tell them it's waiting — nobody checks a page they don't know about.
  const emails = await churchTeamEmails(churchId);
  await Promise.allSettled(
    emails.map((to) =>
      sendEmail({
        to,
        subject: `${hq.name} would like to add ${target.name} as a branch`,
        fromName: hq.name,
        html: emailLayout(
          "A church network invitation",
          `<p><b>${escapeHtml(hq.name)}</b> has asked to add <b>${escapeHtml(target.name)}</b> to its network as a branch.</p>
           ${message ? `<p style="border-left:3px solid #ddd;padding-left:12px;color:#555">${escapeHtml(message)}</p>` : ""}
           <p>Your church keeps its own account, data and plan. Accepting only lets the headquarters see roll-up numbers — attendance, membership and giving totals — never your member records.</p>`,
          { label: "Review the request", url: `${BASE_URL}/branches` },
        ),
        text: `${hq.name} has asked to add ${target.name} to its network. Review it at ${BASE_URL}/branches`,
      }),
    ),
  );

  await audit({
    churchId: hq.id,
    action: "settings.branch.invite",
    summary: `Invited ${target.name} to join the network as a branch`,
    targetType: "church",
    targetId: churchId,
    targetLabel: target.name,
    meta: { message, notified: emails.length },
    severity: "notice",
  });

  revalidatePath("/branches");
  return { ok: true };
}

/* ============================================================
 * Answering an invitation
 * ========================================================== */

const respondSchema = z.object({
  id: z.string().uuid(),
  accept: z.boolean(),
});

export async function respondToBranchRequest(
  input: z.input<typeof respondSchema>,
): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("branches");
  if (gate) return gate;
  const { church: mine } = await requireChurch();
  await requireCan("settings.manage");

  const parsed = respondSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { id, accept } = parsed.data;

  // Only the invited church may answer, and only while it is still pending.
  const [req] = await db
    .select({
      id: branchRequest.id,
      parentChurchId: branchRequest.parentChurchId,
    })
    .from(branchRequest)
    .where(
      and(
        eq(branchRequest.id, id),
        eq(branchRequest.childChurchId, mine.id),
        eq(branchRequest.status, "pending"),
      ),
    )
    .limit(1);
  if (!req) return { ok: false, error: "That request is no longer open." };

  await db
    .update(branchRequest)
    .set({ status: accept ? "accepted" : "declined", respondedAt: new Date() })
    .where(eq(branchRequest.id, id));

  if (accept) {
    await db
      .update(church)
      .set({ parentChurchId: req.parentChurchId })
      .where(eq(church.id, mine.id));
  }

  await audit({
    churchId: mine.id,
    action: accept ? "settings.branch.grant" : "settings.branch.revoke",
    summary: accept
      ? "Accepted a network invitation — the headquarters can now see roll-up totals"
      : "Declined a network invitation",
    targetType: "church",
    targetId: req.parentChurchId,
    meta: { requestId: id, accepted: accept },
    severity: "critical",
  });

  revalidatePath("/branches");
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Withdraw an invitation that hasn't been answered. */
export async function cancelBranchRequest(id: string): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("branches");
  if (gate) return gate;
  const { church: hq } = await requireChurch();
  await requireCan("settings.manage");
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };

  await db
    .update(branchRequest)
    .set({ status: "cancelled", respondedAt: new Date() })
    .where(
      and(
        eq(branchRequest.id, id),
        eq(branchRequest.parentChurchId, hq.id),
        eq(branchRequest.status, "pending"),
      ),
    );

  await audit({
    churchId: hq.id,
    action: "settings.branch.update",
    summary: "Withdrew a branch invitation",
    targetType: "branch-request",
    targetId: id,
  });

  revalidatePath("/branches");
  return { ok: true };
}

/* ============================================================
 * Managing branches
 * ========================================================== */

const zoneSchema = z.object({
  churchId: z.string().min(1),
  zone: z.preprocess(emptyToNull, z.string().trim().max(80).nullable()),
});

/** Group a branch into a zone. Only the headquarters can set this. */
export async function setBranchZone(
  input: z.input<typeof zoneSchema>,
): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("branches");
  if (gate) return gate;
  const { church: hq } = await requireChurch();
  await requireCan("settings.manage");

  const parsed = zoneSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const updated = await db
    .update(church)
    .set({ zone: parsed.data.zone })
    .where(
      and(
        eq(church.id, parsed.data.churchId),
        eq(church.parentChurchId, hq.id), // scope: only our own branches
      ),
    )
    .returning({ id: church.id });
  if (updated.length === 0)
    return { ok: false, error: "That church isn't one of your branches." };

  await audit({
    churchId: hq.id,
    action: "settings.branch.update",
    summary: parsed.data.zone
      ? `Put a branch in the "${parsed.data.zone}" zone`
      : "Removed a branch from its zone",
    targetType: "church",
    targetId: parsed.data.churchId,
    meta: { zone: parsed.data.zone },
  });

  revalidatePath("/branches");
  return { ok: true };
}

const bulkZoneSchema = z.object({
  churchIds: z.array(z.string()).min(1, "Pick at least one branch"),
  zone: z.preprocess(emptyToNull, z.string().trim().max(80).nullable()),
});

export async function setBranchZones(
  input: z.input<typeof bulkZoneSchema>,
): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("branches");
  if (gate) return gate;
  const { church: hq } = await requireChurch();
  await requireCan("settings.manage");

  const parsed = bulkZoneSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  await db
    .update(church)
    .set({ zone: parsed.data.zone })
    .where(
      and(
        inArray(church.id, parsed.data.churchIds),
        eq(church.parentChurchId, hq.id),
      ),
    );

  await audit({
    churchId: hq.id,
    action: "settings.branch.update",
    summary: `Moved ${parsed.data.churchIds.length} branch${parsed.data.churchIds.length === 1 ? "" : "es"} into ${parsed.data.zone ? `the "${parsed.data.zone}" zone` : "no zone"}`,
    targetType: "church",
    meta: { churchIds: parsed.data.churchIds, zone: parsed.data.zone },
  });

  revalidatePath("/branches");
  return { ok: true };
}

/**
 * Remove a branch from the network. Either side can do this for their own
 * link — a branch is never trapped in someone else's network.
 */
export async function removeBranch(churchId: string): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("branches");
  if (gate) return gate;
  const { church: mine } = await requireChurch();
  await requireCan("settings.manage");

  const updated = await db
    .update(church)
    .set({ parentChurchId: null, zone: null })
    .where(
      and(
        eq(church.id, churchId),
        // Our own branch, or ourselves leaving our headquarters.
        churchId === mine.id
          ? sql`${church.parentChurchId} is not null`
          : eq(church.parentChurchId, mine.id),
      ),
    )
    .returning({ id: church.id });
  if (updated.length === 0)
    return { ok: false, error: "That link no longer exists." };

  await audit({
    churchId: mine.id,
    action: "settings.branch.revoke",
    summary:
      churchId === mine.id
        ? "Left the church network"
        : "Removed a branch from the network",
    targetType: "church",
    targetId: churchId,
    severity: "critical",
  });

  revalidatePath("/branches");
  revalidatePath("/dashboard");
  return { ok: true };
}

/* ============================================================
 * Scheduled roll-up reports
 * ========================================================== */

const settingSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(["weekly", "monthly"]),
  recipients: z
    .array(z.string().trim().email("Check that email address").max(160))
    .max(10, "Ten addresses is the limit")
    .default([]),
});

export async function saveReportSetting(
  input: z.input<typeof settingSchema>,
): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("branches");
  if (gate) return gate;
  const { church: hq } = await requireChurch();
  await requireCan("settings.manage");

  const parsed = settingSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  await db
    .insert(hqReportSetting)
    .values({
      churchId: hq.id,
      enabled: d.enabled,
      frequency: d.frequency,
      recipients: d.recipients,
    })
    .onConflictDoUpdate({
      target: hqReportSetting.churchId,
      set: {
        enabled: d.enabled,
        frequency: d.frequency,
        recipients: d.recipients,
      },
    });

  await audit({
    churchId: hq.id,
    action: "settings.branch_reports.update",
    summary: d.enabled
      ? `Turned ${d.frequency} branch reports on for ${d.recipients.length} recipient${d.recipients.length === 1 ? "" : "s"}`
      : "Turned branch reports off",
    targetType: "church",
    targetId: hq.id,
    meta: { enabled: d.enabled, frequency: d.frequency, recipients: d.recipients },
    severity: "notice",
  });

  revalidatePath("/branches");
  return { ok: true };
}

/** Churches this headquarters could invite, for the search box. */
export async function findChurchesToInvite(
  query: string,
): Promise<{ id: string; name: string; city: string | null; state: string | null }[]> {
  const { church: hq } = await requireChurch();
  await requireCan("settings.manage");

  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

  return db
    .select({
      id: church.id,
      name: church.name,
      city: church.city,
      state: church.state,
    })
    .from(church)
    .where(
      and(
        isNull(church.parentChurchId),
        sql`${church.id} <> ${hq.id}`,
        sql`${church.name} ilike ${like}`,
      ),
    )
    .orderBy(church.name)
    .limit(15);
}

/* ============================================================
 * How a network is organised — the bands the church invents itself
 *
 * A band is the HQ's filing system, not the branch's: a branch is a standalone
 * church with its own plan and logins, and this link only ever grants the HQ
 * reporting across them. So every one of these needs `settings.manage` at the
 * HEADQUARTERS, and every id that arrives from a browser is checked against
 * that headquarters inside lib/branch-groups.ts before anything moves.
 * ========================================================== */

const bandSchema = z.object({
  name: z.string().trim().min(1, "Give the group a name").max(120),
  kind: z.string().trim().max(40).default("Group"),
  parentId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
});

export async function createBranchBand(
  input: z.input<typeof bandSchema>,
): Promise<ActionResult> {
  const gate = await refuseWithoutFeature("branches");
  if (gate) return gate;
  const { church: hq, user } = await requireChurch();
  await requireCan("settings.manage");

  const parsed = bandSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const res = await createBand({
    hqChurchId: hq.id,
    name: parsed.data.name,
    kind: parsed.data.kind,
    parentId: parsed.data.parentId,
    createdBy: user?.id ?? null,
  });
  if (!res.ok) return res;

  await audit({
    churchId: hq.id,
    action: "settings.branch.update",
    summary: `Added the ${parsed.data.kind.toLowerCase()} group "${parsed.data.name}"`,
    targetType: "church",
    meta: { bandId: res.id, parentId: parsed.data.parentId },
  });

  revalidatePath("/branches");
  return { ok: true };
}

/** Renaming does not move anything, so it does not take a parent. */
const renameSchema = z.object({
  bandId: z.string().uuid(),
  name: z.string().trim().min(1, "Give the group a name").max(120),
  kind: z.string().trim().max(40).default("Group"),
});

export async function renameBranchBand(
  input: z.input<typeof renameSchema>,
): Promise<ActionResult> {
  const gate = await refuseWithoutFeature("branches");
  if (gate) return gate;
  const { church: hq } = await requireChurch();
  await requireCan("settings.manage");

  const parsed = renameSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const res = await renameBand({
    hqChurchId: hq.id,
    bandId: parsed.data.bandId,
    name: parsed.data.name,
    kind: parsed.data.kind,
  });
  if (!res.ok) return res;

  revalidatePath("/branches");
  return { ok: true };
}

const moveSchema = z.object({
  bandId: z.string().uuid(),
  parentId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
});

export async function moveBranchBand(
  input: z.input<typeof moveSchema>,
): Promise<ActionResult> {
  const gate = await refuseWithoutFeature("branches");
  if (gate) return gate;
  const { church: hq } = await requireChurch();
  await requireCan("settings.manage");

  const parsed = moveSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  // Refused with a reason if it would make a loop. See `canReparent`.
  const res = await moveBand({
    hqChurchId: hq.id,
    bandId: parsed.data.bandId,
    parentId: parsed.data.parentId,
  });
  if (!res.ok) return res;

  revalidatePath("/branches");
  return { ok: true };
}

export async function deleteBranchBand(input: {
  bandId: string;
}): Promise<ActionResult> {
  const gate = await refuseWithoutFeature("branches");
  if (gate) return gate;
  const { church: hq } = await requireChurch();
  await requireCan("settings.manage");

  if (typeof input?.bandId !== "string") return { ok: false, error: "Invalid" };

  /*
   * The bands inside it go too — that is what a person means by deleting a
   * region, and what the database's cascade says. The CHURCHES do not: they
   * become unfiled and nothing about them is touched. The dialog says both
   * before anybody agrees to it.
   */
  const res = await deleteBand({ hqChurchId: hq.id, bandId: input.bandId });
  if (!res.ok) return res;

  await audit({
    churchId: hq.id,
    action: "settings.branch.update",
    summary:
      res.branchesUnfiled > 0
        ? `Deleted a branch group; ${res.branchesUnfiled} branch${res.branchesUnfiled === 1 ? "" : "es"} became unfiled`
        : "Deleted an empty branch group",
    severity: "notice",
    targetType: "church",
    meta: { bandId: input.bandId, branchesUnfiled: res.branchesUnfiled },
  });

  revalidatePath("/branches");
  return { ok: true };
}

const fileSchema = z.object({
  churchIds: z.array(z.string()).min(1, "Pick at least one branch"),
  bandId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
});

export async function fileBranchesInBand(
  input: z.input<typeof fileSchema>,
): Promise<ActionResult> {
  const gate = await refuseWithoutFeature("branches");
  if (gate) return gate;
  const { church: hq } = await requireChurch();
  await requireCan("settings.manage");

  const parsed = fileSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const res = await fileBranches({
    hqChurchId: hq.id,
    churchIds: parsed.data.churchIds,
    bandId: parsed.data.bandId,
  });
  if (!res.ok) return res;

  await audit({
    churchId: hq.id,
    action: "settings.branch.update",
    summary: `Filed ${res.moved} branch${res.moved === 1 ? "" : "es"} ${parsed.data.bandId ? "into a group" : "out of their group"}`,
    targetType: "church",
    meta: { churchIds: parsed.data.churchIds, bandId: parsed.data.bandId },
  });

  revalidatePath("/branches");
  return { ok: true };
}
