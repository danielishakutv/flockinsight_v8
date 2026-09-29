import { and, eq, max } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceSession,
  church,
  giving,
  member,
  session,
  staff,
  user,
} from "@/db/schema";
import { sendEmail } from "@/lib/mailer";
import {
  inactiveWeekEmail,
  reLoginEmail,
  weekendRecordEmail,
} from "@/lib/reminder-emails";
import { runFirstTimers } from "@/lib/first-timers";
import { withCronRun } from "@/lib/cron-run";
import { getChurchHealth } from "@/lib/platform-health";
import { shouldRemind, type ReminderKind } from "@/lib/reminder-rules";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/reminders  — run daily. Sends at most one reminder email per
 * church based on inactivity. Auth via ?key=CRON_SECRET or Bearer header.
 * Windowed conditions (e.g. 3–4 days) mean each reminder fires once.
 *
 * `?dry=1` decides everything and sends nothing, answering "who would hear from
 * us today, and why" without putting it in anybody's inbox. It skips the
 * housekeeping that follows the ladder AND stays outside `withCronRun`, because
 * a dry run that wrote a heartbeat would tell the health page the daily job had
 * run — a rehearsal silencing the alarm for the real thing.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const key =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("key");
  if (!secret || key !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const dry = url.searchParams.get("dry") === "1";

  const run = async () => {
  // Owners of active churches.
  const owners = await db
    .select({
      churchId: church.id,
      churchName: church.name,
      ownerId: user.id,
      ownerEmail: user.email,
      ownerName: user.name,
    })
    .from(church)
    .innerJoin(
      staff,
      and(eq(staff.organizationId, church.id), eq(staff.role, "owner")),
    )
    .innerJoin(user, eq(user.id, staff.userId))
    .where(eq(church.status, "active"));

  const [attMax, givMax, memMax, sessMax] = await Promise.all([
    db
      .select({ churchId: attendanceSession.churchId, last: max(attendanceSession.date) })
      .from(attendanceSession)
      .groupBy(attendanceSession.churchId),
    db
      .select({ churchId: giving.churchId, last: max(giving.date) })
      .from(giving)
      .groupBy(giving.churchId),
    db
      .select({ churchId: member.churchId, last: max(member.createdAt) })
      .from(member)
      .groupBy(member.churchId),
    db
      .select({ userId: session.userId, last: max(session.updatedAt) })
      .from(session)
      .groupBy(session.userId),
  ]);

  /*
   * Which churches are actually under way.
   *
   * The ladder below presumes a routine, so a church that never began one must
   * be excluded before any rule can claim it. Computing the set here — once,
   * from the same source the activation board reads — is what stops suppression
   * and activation nudges ever disagreeing about who has started.
   */
  const healthBy = new Map((await getChurchHealth()).map((h) => [h.churchId, h.health]));

  const attBy = new Map(attMax.map((r) => [r.churchId, r.last]));
  const givBy = new Map(givMax.map((r) => [r.churchId, r.last]));
  const memBy = new Map(memMax.map((r) => [r.churchId, r.last]));
  const loginBy = new Map(sessMax.map((r) => [r.userId, r.last]));

  const now = new Date();

  let sent = 0;
  let skippedNotStarted = 0;
  const wouldSend: { church: string; to: string; kind: ReminderKind; health: string }[] = [];
  const byKind: Record<ReminderKind, number> = { login: 0, weekend: 0, inactive: 0 };

  for (const o of owners) {
    if (!o.ownerEmail) continue;
    const health = healthBy.get(o.churchId) ?? "healthy";
    if (health === "never_activated") skippedNotStarted++;

    const kind = shouldRemind({
      health,
      lastAtt: attBy.get(o.churchId) ?? null, // "YYYY-MM-DD"
      lastGiv: givBy.get(o.churchId) ?? null,
      lastMem: memBy.get(o.churchId) ?? null,
      lastLogin: loginBy.get(o.ownerId) ?? null,
      now,
    });

    const email =
      kind === "inactive"
        ? inactiveWeekEmail(o.ownerName, o.churchName)
        : kind === "weekend"
          ? weekendRecordEmail(o.ownerName, o.churchName)
          : kind === "login"
            ? reLoginEmail(o.ownerName, o.churchName)
            : null;

    if (email && kind) {
      if (dry) {
        wouldSend.push({ church: o.churchName, to: o.ownerEmail, kind, health });
        byKind[kind] = (byKind[kind] ?? 0) + 1;
        continue;
      }
      try {
        const ok = await sendEmail({
          to: o.ownerEmail,
          subject: email.subject,
          html: email.html,
          text: email.text,
        });
        if (ok) {
          sent++;
          byKind[kind] = (byKind[kind] ?? 0) + 1;
        }
      } catch {
        /* keep going */
      }
    }
  }

  if (dry) {
    return new Response(
      JSON.stringify({
        ok: true,
        dry: true,
        checked: owners.length,
        skippedNotStarted,
        byKind,
        wouldSend,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // Piggyback the daily first-timer nurture sequence so it runs without needing
  // a separate crontab entry. Idempotent — safe if the dedicated cron also runs.
  let firstTimers: Awaited<ReturnType<typeof runFirstTimers>> | null = null;
  try {
    firstTimers = await runFirstTimers();
  } catch (e) {
    console.error("[cron/reminders] first-timers failed", e);
  }

  // Housekeeping: clear out expired one-time codes + old analytics events.
  try {
    const { purgeExpiredOtps } = await import("@/lib/otp");
    await purgeExpiredOtps();
  } catch (e) {
    console.error("[cron/reminders] otp purge failed", e);
  }
  try {
    const { pruneOldEvents } = await import("@/lib/analytics");
    await pruneOldEvents(180);
  } catch (e) {
    console.error("[cron/reminders] analytics prune failed", e);
  }

  // Settle any SMS sender IDs the network has now approved/rejected, notifying
  // the church + superadmins.
  let senderIds: Awaited<ReturnType<typeof import("@/lib/sender-id-checks").runSenderIdChecks>> | null = null;
  try {
    const { runSenderIdChecks } = await import("@/lib/sender-id-checks");
    senderIds = await runSenderIdChecks();
  } catch (e) {
    console.error("[cron/reminders] sender-id checks failed", e);
  }

  // Nudge members with an outstanding pledge, once per cadence period.
  let pledges: Awaited<ReturnType<typeof import("@/lib/pledge-reminders").runPledgeReminders>> | null = null;
  try {
    const { runPledgeReminders } = await import("@/lib/pledge-reminders");
    pledges = await runPledgeReminders();
  } catch (e) {
    console.error("[cron/reminders] pledge reminders failed", e);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      checked: owners.length,
      sent,
      byKind,
      skippedNotStarted,
      firstTimers,
      senderIds,
      pledges,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
  };

  return dry ? run() : withCronRun("reminders", run);
}
