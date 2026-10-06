"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { firstTimerSignup } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { recordAudit } from "@/lib/audit";
import {
  ensureFirstTimerSignup,
  regenerateWelcomeSlug,
  registerFirstTimer,
  welcomeUrl,
} from "@/lib/first-timer-intake";
import type { FirstTimerIntake } from "@/lib/first-timer-shared";

export type ActionResult =
  | { ok: true; outcome: "created" | "matched"; memberId: string; message: string }
  | { ok: false; error: string };

/**
 * Write a first-time worshipper down.
 *
 * Note what this action does NOT take: a status. There is no way to reach this
 * code and end up with an active member, which is the entire point — the old
 * route to registering a visitor was the membership form, whose status
 * dropdown defaults to Active, and missing it filed first-timers as members
 * where follow-up never saw them again.
 */
export async function addFirstTimer(
  intake: FirstTimerIntake,
): Promise<ActionResult> {
  const { church, user } = await requireChurch();

  const gate = await refuseWithoutFeature("followUp");
  if (gate) return { ok: false, error: gate.error };

  if (!(await can("followup.manage"))) {
    return { ok: false, error: "You don't have permission to do that." };
  }

  const res = await registerFirstTimer({
    churchId: church.id,
    intake,
    createdBy: user.id,
  });
  if (!res.ok) return { ok: false, error: res.error };

  const name = [intake.firstName, intake.lastName].filter(Boolean).join(" ");

  await recordAudit({
    actorUserId: user.id,
    actorName: user.name,
    churchId: church.id,
    action:
      res.result.outcome === "created"
        ? "first_timer_register"
        : "first_timer_matched",
    summary:
      res.result.outcome === "created"
        ? `Registered first-time worshipper "${name}"`
        : `"${name}" was already on the register — put into follow-up instead of being added twice`,
    targetType: "member",
    targetId: res.result.memberId,
    targetLabel: name,
  });

  revalidatePath("/first-timers");
  revalidatePath("/follow-up");
  revalidatePath("/members");

  return {
    ok: true,
    outcome: res.result.outcome,
    memberId: res.result.memberId,
    message:
      res.result.outcome === "created"
        ? `${name} is on the register as a visitor, and in follow-up.`
        : res.result.alreadyInFollowUp
          ? `${name} is already on your register and already in follow-up — nothing was duplicated.`
          : `${name} was already on your register, so they were added to follow-up rather than entered twice.`,
  };
}

/* ------------------------------------------------------------------ *
 * The public link
 * ------------------------------------------------------------------ */

export type LinkResult = { ok: true; url: string } | { ok: false; error: string };

async function requireManage() {
  const { church, user } = await requireChurch();
  if (!(await can("followup.manage"))) return null;
  return { church, user };
}

/** Turn the public welcome link on or off. Off by default; this is the switch. */
export async function setWelcomeLinkEnabled(
  enabled: boolean,
): Promise<LinkResult> {
  const ctx = await requireManage();
  if (!ctx) return { ok: false, error: "You don't have permission to do that." };

  const signup = await ensureFirstTimerSignup({
    id: ctx.church.id,
    name: ctx.church.name,
    handle: ctx.church.handle ?? null,
  });

  await db
    .update(firstTimerSignup)
    .set({ enabled })
    .where(eq(firstTimerSignup.churchId, ctx.church.id));

  await recordAudit({
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    churchId: ctx.church.id,
    action: "first_timer_link",
    summary: enabled
      ? "Turned the public first-timer registration link ON"
      : "Turned the public first-timer registration link off",
    severity: enabled ? "notice" : undefined,
  });

  revalidatePath("/first-timers");
  return { ok: true, url: welcomeUrl(signup.slug) };
}

/**
 * Issue a new link, which invalidates every QR code already printed.
 *
 * Worth saying out loud in the UI rather than only here: a church that has put
 * the code on a thousand welcome cards has just made all of them dead.
 */
export async function regenerateWelcomeLink(): Promise<LinkResult> {
  const ctx = await requireManage();
  if (!ctx) return { ok: false, error: "You don't have permission to do that." };

  await ensureFirstTimerSignup({
    id: ctx.church.id,
    name: ctx.church.name,
    handle: ctx.church.handle ?? null,
  });
  const slug = await regenerateWelcomeSlug(
    ctx.church.id,
    ctx.church.handle || ctx.church.name,
  );

  await recordAudit({
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    churchId: ctx.church.id,
    action: "first_timer_link",
    summary: "Issued a new first-timer link — any QR code already printed now leads nowhere",
    severity: "notice",
  });

  revalidatePath("/first-timers");
  return { ok: true, url: welcomeUrl(slug) };
}
