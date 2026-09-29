import "server-only";
import { revalidateTag } from "next/cache";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, outreachCampaign, outreachRecipient } from "@/db/schema";
import { getActivationBoard, type ActivationRow } from "@/lib/activation";
import { getSetting } from "@/lib/platform-settings";
import { LEADERSHIP_REACH, sendOutreach } from "@/lib/outreach";
import type { FunnelStep } from "@/lib/health-rules";

/**
 * The sequence sent to a church that signed up and never started.
 *
 * Written for somebody at the beginning, which is the whole reason it exists
 * apart from the reminder ladder: those messages presume a routine, and to a
 * church that never began one they read as a reproach. These presume nothing
 * and ask for one small thing.
 */

export const ACTIVATION_PURPOSE = "activation";

/** Off until somebody has read the copy and sent a few by hand. */
export const ENABLED_KEY = "activation_nudges_enabled";

/** No church gets two automated platform emails inside this window. */
export const RECENCY_DAYS = 6;

/** A church opted out for good. -1 simply never matches a step. */
export const OPTED_OUT = -1;

type Step = {
  /** Written to `church.activationNudgeStage` once sent. */
  stage: number;
  /** Days since signup before this step is due. */
  afterDays: number;
  subject: string;
  /** `{name}` is filled per recipient by the outreach templater. */
  body: (gap: FunnelStep | null) => string;
  ctaLabel: string;
  ctaUrl: string;
};

const GAP_LINE: Record<FunnelStep, string> = {
  members:
    "The quickest start is one person: add a single member and the rest of the app has something to work with.",
  staff:
    "If someone else helps on a Sunday, give them a login. Most churches find the register gets kept once two people can reach it.",
  attendance:
    "You have people on the books already. Recording one Sunday takes about a minute, and it turns the rest of the app on.",
  giving:
    "You are counting attendance already. Adding what came in on the same screen gives you both halves of a Sunday.",
  message:
    "You have the data in. Sending one message to a group is usually the point at which a church says it started paying for itself.",
};

const LADDER: Step[] = [
  {
    stage: 1,
    afterDays: 3,
    subject: "Getting started on FlockInsight",
    body: (gap) =>
      [
        "Hi {name},",
        "You set your church up on FlockInsight a few days ago and I do not think you have had a chance to use it yet. In my experience that usually means the first step was not obvious, rather than that you changed your mind.",
        gap
          ? GAP_LINE[gap]
          : "Everything is set up. It just needs a first Sunday.",
        "If something got in the way, reply to this email and tell me what it was. I read every one.",
      ].join("\n\n"),
    ctaLabel: "Open FlockInsight",
    ctaUrl: "/dashboard",
  },
  {
    stage: 2,
    afterDays: 10,
    subject: "Can I help you set your church up?",
    body: (gap) =>
      [
        "Hi {name},",
        "FlockInsight is still waiting for your church, and I would rather find out why than keep sending emails.",
        gap
          ? GAP_LINE[gap]
          : "Everything is ready. It just needs a first Sunday.",
        "If it would be easier for me to set it up with you over the phone or WhatsApp, say the word and we will book fifteen minutes. If FlockInsight turned out not to be what you needed, tell me that too. It is genuinely useful to know.",
      ].join("\n\n"),
    ctaLabel: "Open FlockInsight",
    ctaUrl: "/dashboard",
  },
  {
    stage: 3,
    afterDays: 24,
    subject: "Last note about getting started",
    body: () =>
      [
        "Hi {name},",
        "I have not heard back and your church has not been used, so this is the last email I will send about getting started.",
        "Your account stays exactly as it is. Nothing is deleted, and you can pick it up whenever suits you. If you would like a hand at any point, reply and I will help personally.",
        "Either way, thank you for trying it.",
      ].join("\n\n"),
    ctaLabel: "Open FlockInsight",
    ctaUrl: "/dashboard",
  },
];

/**
 * The step a church is due, or null.
 *
 * The furthest due step wins, so a church found three weeks late is not walked
 * through a sequence that opens by saying it signed up a few days ago.
 */
export function dueStep(row: ActivationRow, stage: number): Step | null {
  if (stage === OPTED_OUT) return null;
  const due = LADDER.filter(
    (s) => s.stage > stage && row.daysSinceSignup >= s.afterDays,
  );
  return due.length ? due[due.length - 1] : null;
}

export type NudgePlan = {
  churchId: string;
  churchName: string;
  stage: number;
  subject: string;
  stalledAt: FunnelStep | null;
};

export type NudgeRun = {
  enabled: boolean;
  considered: number;
  planned: NudgePlan[];
  sent: number;
  failed: number;
  suppressedRecent: number;
};

/** Churches already messaged automatically inside the recency window. */
async function recentlyMessaged(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const since = new Date(Date.now() - RECENCY_DAYS * 86_400_000);
  const rows = await db
    .selectDistinct({ churchId: outreachRecipient.churchId })
    .from(outreachRecipient)
    .innerJoin(
      outreachCampaign,
      eq(outreachCampaign.id, outreachRecipient.campaignId),
    )
    .where(
      and(
        inArray(outreachRecipient.churchId, ids),
        gte(outreachCampaign.createdAt, since),
        sql`outreach_campaign.purpose is not null`,
      ),
    );
  return new Set(rows.map((r) => r.churchId).filter((x): x is string => !!x));
}

function mode<T extends string>(xs: T[]): T {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Walk every stalled church one step along the sequence.
 *
 * Off by default. With nine stalled churches, one badly worded email is eleven
 * per cent of the population this exists to recover, so the runner computes the
 * whole plan and sends nothing until somebody has read the copy and turned it
 * on. Until then the plan is the product: it appears on the activation board as
 * "this is what would go out".
 */
/**
 * Work out what would go out. Sends nothing, ever.
 *
 * Separate from the sender because the activation board renders this on every
 * page load: if planning and sending shared an entry point, opening the
 * dashboard with automation on would post mail to nine churches. Splitting
 * them makes that impossible rather than merely unlikely.
 */
export async function planActivationNudges(): Promise<NudgeRun> {
  const enabled = (await getSetting(ENABLED_KEY, "off")) === "on";

  /*
   * Health is recomputed here rather than handed in. A church that activated
   * since the board was last rendered has to drop out of the set before the
   * ladder is consulted, or it receives step three of a sequence it already
   * graduated from — the most embarrassing email this system could send.
   */
  const board = await getActivationBoard();
  const stalled = board.stalled;
  if (stalled.length === 0) {
    return {
      enabled,
      considered: 0,
      planned: [],
      sent: 0,
      failed: 0,
      suppressedRecent: 0,
    };
  }

  const ids = stalled.map((r) => r.churchId);

  const stages = await db
    .select({ id: church.id, stage: church.activationNudgeStage })
    .from(church)
    .where(inArray(church.id, ids));
  const stageBy = new Map(stages.map((r) => [r.id, r.stage]));

  const recent = await recentlyMessaged(ids);

  const planned: NudgePlan[] = [];
  let suppressedRecent = 0;

  for (const row of stalled) {
    const step = dueStep(row, stageBy.get(row.churchId) ?? 0);
    if (!step) continue;
    if (recent.has(row.churchId)) {
      suppressedRecent++;
      continue;
    }
    planned.push({
      churchId: row.churchId,
      churchName: row.name,
      stage: step.stage,
      subject: step.subject,
      stalledAt: row.stalledAt,
    });
  }

  return {
    enabled,
    considered: stalled.length,
    planned,
    sent: 0,
    failed: 0,
    suppressedRecent,
  };
}

/**
 * Send whatever is due.
 *
 * Called by the daily cron, and by the "send these now" button with `force`.
 * `force` deliberately overrides the setting: the intended path is to send a
 * first round by hand, read the replies, and only then hand it to the cron.
 */
export async function runActivationNudges(
  opts: { force?: boolean } = {},
): Promise<NudgeRun> {
  const plan = await planActivationNudges();
  const { planned, suppressedRecent } = plan;

  if ((!plan.enabled && !opts.force) || planned.length === 0) return plan;

  let sent = 0;
  let failed = 0;

  /*
   * One campaign per step rather than per church: the steps carry different
   * copy, and grouping this way keeps the history readable while
   * outreach_recipient still holds per-person delivery truth.
   */
  for (const step of LADDER) {
    const forStep = planned.filter((p) => p.stage === step.stage);
    if (forStep.length === 0) continue;

    // Churches at the same step can be stuck in different places, so the gap
    // line comes from the commonest one rather than a guess.
    const gaps = forStep
      .map((p) => p.stalledAt)
      .filter((g): g is FunnelStep => !!g);
    const gap = gaps.length ? mode(gaps) : null;
    const stepIds = forStep.map((p) => p.churchId);

    try {
      const res = await sendOutreach({
        channel: "email",
        audience: { kind: "churches", filter: "picked", ids: stepIds },
        subject: step.subject,
        body: step.body(gap),
        ctaLabel: step.ctaLabel,
        ctaUrl: step.ctaUrl,
        reach: LEADERSHIP_REACH,
        purpose: ACTIVATION_PURPOSE,
      });
      sent += res.sent;
      failed += res.failed;

      await db
        .update(church)
        .set({ activationNudgeStage: step.stage })
        .where(inArray(church.id, stepIds));
    } catch (e) {
      console.error("[activation-nudges] step failed", step.stage, e);
      failed += forStep.length;
    }
  }

  /*
   * The board reads cached platform stats, and nothing in this repo has ever
   * invalidated that tag. Without this the operator watches a send land, sees
   * the board unchanged for a minute, and sends it again.
   */
  revalidateTag("platform-stats", "max");

  return { ...plan, sent, failed, suppressedRecent };
}

/** Stop auto-nudging one church, for good. */
export async function optOutOfNudges(churchId: string): Promise<void> {
  await db
    .update(church)
    .set({ activationNudgeStage: OPTED_OUT })
    .where(eq(church.id, churchId));
  revalidateTag("platform-stats", "max");
}

/** The most recent automated activation sends, for the board. */
export async function recentNudges(limit = 5) {
  return db
    .select({
      id: outreachCampaign.id,
      subject: outreachCampaign.subject,
      recipients: outreachCampaign.recipients,
      sent: outreachCampaign.sent,
      failed: outreachCampaign.failed,
      createdAt: outreachCampaign.createdAt,
    })
    .from(outreachCampaign)
    .where(eq(outreachCampaign.purpose, ACTIVATION_PURPOSE))
    .orderBy(desc(outreachCampaign.createdAt))
    .limit(limit);
}
