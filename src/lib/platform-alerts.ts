import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { platformAlert, user } from "@/db/schema";
import { getFloatOverviewFresh, type FloatOverview } from "@/lib/float";
import { getCronLiveness } from "@/lib/cron-run";
import { notifySuperAdminsByEmail } from "@/lib/notifications";
import { sendPushToUsers } from "@/lib/push";
import { listBackups } from "@/lib/backups";
import { formatMoney } from "@/lib/money";

/**
 * Platform alerting.
 *
 * Alerts fire once, when a condition becomes true, and again only after it has
 * recovered. A rule that stays true must never keep notifying — an operator
 * who is paged every 30 minutes about the same thing stops reading the pages.
 */

export type Severity = "info" | "warning" | "critical";

export type EvaluatedAlert = {
  key: string;
  severity: Severity;
  message: string;
  href: string;
};

const BACKUP_MAX_AGE_HOURS = 48;
const TICKET_MAX_AGE_HOURS = 24;
const TERMII_FAILURES_BEFORE_ALERT = 3;

async function backupIsStale(): Promise<boolean> {
  try {
    const backups = await listBackups();
    if (backups.length === 0) return true;
    const newest = Math.max(...backups.map((b) => b.mtime));
    return Date.now() - newest > BACKUP_MAX_AGE_HOURS * 3_600_000;
  } catch {
    // Can't read the backup directory (e.g. running locally) — not an alert.
    return false;
  }
}

async function staleTicketCount(): Promise<number> {
  const res = await db.execute(sql`
    select count(*) as n from support_ticket
    where status = 'open'
      and last_reply_at < now() - make_interval(hours => ${TICKET_MAX_AGE_HOURS})
  `);
  return Number((res.rows[0] as { n?: string } | undefined)?.n ?? 0);
}

async function pendingSenderIdCount(): Promise<number> {
  const res = await db.execute(sql`
    select count(*) as n from church
    where sms_sender_status = 'pending' and sms_sender_stage is null
  `);
  return Number((res.rows[0] as { n?: string } | undefined)?.n ?? 0);
}

/** Everything currently wrong, independent of what has already been notified. */
export async function evaluateConditions(
  float?: FloatOverview,
): Promise<EvaluatedAlert[]> {
  const f = float ?? (await getFloatOverviewFresh());
  const [crons, backupStale, staleTickets, pendingSenders] = await Promise.all([
    getCronLiveness(),
    backupIsStale(),
    staleTicketCount(),
    pendingSenderIdCount(),
  ]);

  const alerts: EvaluatedAlert[] = [];

  // --- Float ---------------------------------------------------------------
  if (f.coverage !== null && f.coverage < 1) {
    alerts.push({
      key: "float.coverage.critical",
      severity: "critical",
      message: `Termii cannot cover SMS already sold — coverage is ${Math.round(
        f.coverage * 100,
      )}%. Fund the master wallet now.`,
      href: "/superadmin/health",
    });
  }

  if (f.runwayDays !== null) {
    if (f.runwayDays < f.thresholds.critical) {
      alerts.push({
        key: "float.runway.critical",
        severity: "critical",
        message: `Termii balance runs out in about ${Math.round(
          f.runwayDays,
        )} day(s)${f.balance !== null ? ` (${formatMoney(f.balance, f.currency)} left)` : ""}.`,
        href: "/superadmin/health",
      });
    } else if (f.runwayDays < f.thresholds.warn) {
      alerts.push({
        key: "float.runway.warning",
        severity: "warning",
        message: `Termii balance has about ${Math.round(f.runwayDays)} days left.`,
        href: "/superadmin/health",
      });
    }
  }

  if (f.consecutiveFailures >= TERMII_FAILURES_BEFORE_ALERT) {
    alerts.push({
      key: "float.api.unreachable",
      severity: "warning",
      message: `Termii has not responded for ${f.consecutiveFailures} checks in a row — SMS may be failing silently.`,
      href: "/superadmin/health",
    });
  }

  // --- Infrastructure ------------------------------------------------------
  for (const c of crons) {
    if (c.overdue) {
      // A job that ran before and has now stopped is an incident worth waking
      // someone for. A job that has *never* run is an unfinished crontab —
      // real, but it would otherwise fire eight critical emails the moment
      // this feature is first deployed. That one stays on the dashboard.
      const lastRunAt = c.lastRunAt;
      alerts.push({
        key: `cron.${c.job}.overdue`,
        severity: lastRunAt === null ? "warning" : "critical",
        message:
          lastRunAt === null
            ? `The "${c.label}" job has never run — add it to the crontab.`
            : `The "${c.label}" job has not run since ${lastRunAt
                .toISOString()
                .slice(0, 16)
                .replace("T", " ")}.`,
        href: "/superadmin/health",
      });
    } else if (c.lastOk === false) {
      alerts.push({
        key: `cron.${c.job}.failing`,
        severity: "warning",
        message: `The "${c.label}" job failed on its last run: ${c.lastError ?? "unknown error"}`,
        href: "/superadmin/health",
      });
    }
  }

  if (backupStale) {
    alerts.push({
      key: "backup.stale",
      severity: "critical",
      message: `No database backup in the last ${BACKUP_MAX_AGE_HOURS} hours.`,
      href: "/superadmin/backups",
    });
  }

  // --- Your queue ----------------------------------------------------------
  if (staleTickets > 0) {
    alerts.push({
      key: "support.stale",
      severity: "warning",
      message: `${staleTickets} support ticket${staleTickets === 1 ? "" : "s"} waiting over ${TICKET_MAX_AGE_HOURS}h for a reply.`,
      href: "/superadmin/support",
    });
  }

  if (pendingSenders > 0) {
    alerts.push({
      key: "sms.senders.pending",
      severity: "info",
      message: `${pendingSenders} sender ID${pendingSenders === 1 ? "" : "s"} waiting for review.`,
      href: "/superadmin/sms",
    });
  }

  return alerts;
}

async function superAdminUserIds(): Promise<string[]> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.isSuperAdmin, true));
  return rows.map((r) => r.id);
}

/**
 * Notify about everything that just opened, in one message.
 *
 * Sending one email per alert means a single incident that trips several rules
 * at once buries the operator — so the batch goes out together, with the
 * problems listed in it.
 */
async function dispatchBatch(alerts: EvaluatedAlert[]): Promise<void> {
  // Only the loud ones reach out; warnings and info live on the dashboard.
  const critical = alerts.filter((a) => a.severity === "critical");
  if (critical.length === 0) return;

  const summary =
    critical.length === 1
      ? critical[0].message
      : `${critical.length} problems need your attention:\n\n` +
        critical.map((a) => `• ${a.message}`).join("\n");

  try {
    await notifySuperAdminsByEmail({
      subject:
        critical.length === 1
          ? `FlockInsight alert: ${critical[0].message.slice(0, 80)}`
          : `FlockInsight: ${critical.length} platform alerts`,
      title: "Platform alert",
      body: summary,
      linkPath: critical[0].href,
    });
    const ids = await superAdminUserIds();
    await sendPushToUsers(ids, {
      title:
        critical.length === 1
          ? "FlockInsight alert"
          : `FlockInsight: ${critical.length} alerts`,
      body: critical.length === 1 ? critical[0].message : summary.slice(0, 200),
      url: critical[0].href,
      tag: "platform-alert",
    });
  } catch (e) {
    // Never abort the cron because a notification channel is down.
    console.error("[alerts] dispatch failed", e);
  }
}

export type AlertSyncResult = {
  opened: number;
  resolved: number;
  stillOpen: number;
};

/**
 * Reconcile evaluated conditions against stored state, notifying only on the
 * transition into "open". Rows are never deleted — the history is the record
 * of what went wrong and when.
 */
export async function syncAlerts(float?: FloatOverview): Promise<AlertSyncResult> {
  const current = await evaluateConditions(float);
  const currentByKey = new Map(current.map((a) => [a.key, a]));

  const stored = await db.select().from(platformAlert);
  const storedByKey = new Map(stored.map((s) => [s.key, s]));

  let opened = 0;
  let resolved = 0;
  const newlyOpened: EvaluatedAlert[] = [];

  for (const alert of current) {
    const existing = storedByKey.get(alert.key);
    const isNewlyOpen = !existing || existing.state === "resolved";

    if (isNewlyOpen) {
      await db
        .insert(platformAlert)
        .values({
          key: alert.key,
          severity: alert.severity,
          state: "open",
          message: alert.message,
          openedAt: new Date(),
          resolvedAt: null,
          lastNotifiedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: platformAlert.key,
          set: {
            severity: alert.severity,
            state: "open",
            message: alert.message,
            openedAt: new Date(),
            resolvedAt: null,
            lastNotifiedAt: new Date(),
          },
        });
      opened++;
      newlyOpened.push(alert);
    } else {
      // Already open: refresh the wording, do not re-notify.
      await db
        .update(platformAlert)
        .set({ message: alert.message, severity: alert.severity })
        .where(eq(platformAlert.key, alert.key));
    }
  }

  for (const s of stored) {
    if (s.state === "open" && !currentByKey.has(s.key)) {
      await db
        .update(platformAlert)
        .set({ state: "resolved", resolvedAt: new Date() })
        .where(eq(platformAlert.key, s.key));
      resolved++;
    }
  }

  // One notification for the whole batch, after the state is durably recorded.
  await dispatchBatch(newlyOpened);

  return { opened, resolved, stillOpen: current.length };
}

/** Open alerts for the dashboard, most severe first. */
export async function getOpenAlerts(): Promise<
  { key: string; severity: Severity; message: string; openedAt: Date }[]
> {
  const rows = await db
    .select()
    .from(platformAlert)
    .where(and(eq(platformAlert.state, "open")));

  const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  return rows
    .map((r) => ({
      key: r.key,
      severity: r.severity as Severity,
      message: r.message,
      openedAt: r.openedAt,
    }))
    .sort(
      (a, b) =>
        (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) ||
        a.openedAt.getTime() - b.openedAt.getTime(),
    );
}
