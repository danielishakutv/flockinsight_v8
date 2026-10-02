import "server-only";
import { and, eq, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  contribution,
  contributionContributor,
  contributionEntry,
  contributionPayout,
  media,
} from "@/db/schema";
import { destroyFromCloudinary, type ResourceType } from "@/lib/cloudinary";
import { notifyChurchManagers } from "@/lib/notifications";
import { formatMoney } from "@/lib/money";
import { expectedFor, PROOF_RETENTION_DAYS } from "@/lib/contributions-shared";
import { auditSystem } from "@/lib/audit";

/**
 * The daily housekeeping for group contributions.
 *
 * Two jobs, both run from the existing daily `reminders` cron rather than from a
 * route of their own. A new cron route means a new crontab line on the server,
 * and a scheduled job that exists in the code but not in the crontab is a job
 * that silently never runs — which is exactly the failure mode the health page
 * was built to catch and would not catch here, because nothing would be
 * expecting it.
 */

/* ============================================================
 * 1. The deadline nudge
 * ========================================================== */

export type ReminderOutcome = {
  checked: number;
  notified: number;
  skipped: number;
};

/**
 * Tell a group's managers when a collection is nearly due, or has gone past.
 *
 * Deliberately narrow. It fires at three days out, on the day itself, and three
 * days after — and only ever to the church's own managers, never to the people
 * who owe money. Chasing a congregation by automated message is a pastoral
 * decision, not a feature flag, and this module has no business making it. What
 * the software can usefully say is "this is due on Sunday and eleven people
 * haven't paid", to the person whose job it is.
 *
 * The windows are exact single days rather than ranges, which is what makes the
 * job idempotent without a `reminder_run` table: on any given day a collection
 * matches at most one window, so a second run of the cron sends the same message
 * again only if it runs twice in one day. The notification itself is in-app,
 * which is cheap and silent, so that is an acceptable trade for not adding a
 * table.
 */
export async function runContributionReminders(
  now: Date = new Date(),
): Promise<ReminderOutcome> {
  const today = toDateString(now);

  const pots = await db
    .select({
      id: contribution.id,
      churchId: contribution.churchId,
      title: contribution.title,
      dueDate: contribution.dueDate,
      perPersonAmount: contribution.perPersonAmount,
      targetAmount: contribution.targetAmount,
    })
    .from(contribution)
    .where(and(eq(contribution.status, "open"), isNotNull(contribution.dueDate)))
    .limit(500);

  let notified = 0;
  let skipped = 0;

  for (const pot of pots) {
    if (!pot.dueDate) continue;
    const days = daysBetween(today, pot.dueDate);
    const window =
      days === 3
        ? "in three days"
        : days === 0
          ? "today"
          : days === -3
            ? "three days ago"
            : null;
    if (!window) {
      skipped++;
      continue;
    }

    const [raisedRow] = await db
      .select({ total: sql<string>`coalesce(sum(${contributionEntry.amount}), 0)` })
      .from(contributionEntry)
      .where(
        and(
          eq(contributionEntry.contributionId, pot.id),
          eq(contributionEntry.status, "confirmed"),
        ),
      );
    const raised = Number(raisedRow?.total ?? 0);

    // Who still owes, from the roster. Counted here rather than fetched as a
    // number so the per-person fallback is applied by the same tested helper the
    // screens use.
    const roster = await db
      .select({
        id: contributionContributor.id,
        expectedAmount: contributionContributor.expectedAmount,
      })
      .from(contributionContributor)
      .where(eq(contributionContributor.contributionId, pot.id));

    const paidRows =
      roster.length === 0
        ? []
        : await db
            .select({
              contributorId: contributionEntry.contributorId,
              total: sql<string>`sum(${contributionEntry.amount})`,
            })
            .from(contributionEntry)
            .where(
              and(
                inArray(
                  contributionEntry.contributorId,
                  roster.map((r) => r.id),
                ),
                eq(contributionEntry.status, "confirmed"),
              ),
            )
            .groupBy(contributionEntry.contributorId);
    const paidBy = new Map(
      paidRows.map((r) => [r.contributorId, Number(r.total) || 0]),
    );

    const stillOwing = roster.filter((r) => {
      const expected = expectedFor(r.expectedAmount, pot.perPersonAmount);
      if (expected === null) return false;
      return expected - (paidBy.get(r.id) ?? 0) > 0;
    }).length;

    const [c] = await db
      .select({ currency: church.currency })
      .from(church)
      .where(eq(church.id, pot.churchId))
      .limit(1);
    const currency = c?.currency ?? "NGN";

    const body = [
      `${formatMoney(raised, currency)} collected so far.`,
      stillOwing > 0
        ? `${stillOwing} ${stillOwing === 1 ? "person has" : "people have"} not finished paying.`
        : null,
      days < 0 ? "The deadline has passed." : null,
    ]
      .filter(Boolean)
      .join(" ");

    await notifyChurchManagers({
      churchId: pot.churchId,
      title: `"${pot.title}" was due ${window}`,
      body,
      linkUrl: `/contributions/${pot.id}`,
    }).catch((e) => console.error("[contribution-reminders] notify failed", e));
    notified++;
  }

  return { checked: pots.length, notified, skipped };
}

/* ============================================================
 * 2. Releasing settled receipts
 * ========================================================== */

export type PurgeOutcome = {
  entriesReleased: number;
  payoutsReleased: number;
  bytesFreed: number;
  orphansRemoved: number;
};

/**
 * Give back the storage held by receipts on long-settled collections.
 *
 * Receipts are the one part of this module that bills a church every month they
 * exist, and the bill compounds: a hundred and fifty kilobytes a receipt, forty
 * people, a few collections a year, and a Starter church's 200 MB is gone to
 * paperwork for a levy settled in 2024. So a year after a collection is settled
 * the FILE is deleted and the RECORD that a receipt existed is kept, in
 * `proofReleasedAt`.
 *
 * That distinction is the whole design. "No receipt was ever attached" and "a
 * receipt was attached, held for a year, and released" are different facts about
 * a payment, and a plain empty column tells you neither — which is precisely how
 * a storage saving turns into somebody's missing evidence. A collection that must
 * keep its paperwork sets `keepProofs` and nothing here touches it.
 *
 * It also sweeps up receipts nothing points at: a file uploaded from the public
 * form by somebody who then closed the tab without submitting. Those are
 * genuinely orphaned, and a day's grace is enough to be sure.
 */
export async function purgeSettledProofs(
  now: Date = new Date(),
): Promise<PurgeOutcome> {
  const cutoff = new Date(now.getTime() - PROOF_RETENTION_DAYS * 86_400_000);

  const settled = await db
    .select({ id: contribution.id, churchId: contribution.churchId, title: contribution.title })
    .from(contribution)
    .where(
      and(
        eq(contribution.status, "settled"),
        eq(contribution.keepProofs, false),
        isNotNull(contribution.settledAt),
        lte(contribution.settledAt, cutoff),
      ),
    )
    .limit(200);

  let entriesReleased = 0;
  let payoutsReleased = 0;
  let bytesFreed = 0;

  for (const pot of settled) {
    const [entries, payouts] = await Promise.all([
      db
        .select({ id: contributionEntry.id, proofMediaId: contributionEntry.proofMediaId })
        .from(contributionEntry)
        .where(
          and(
            eq(contributionEntry.contributionId, pot.id),
            isNotNull(contributionEntry.proofMediaId),
          ),
        ),
      db
        .select({
          id: contributionPayout.id,
          proofMediaId: contributionPayout.proofMediaId,
        })
        .from(contributionPayout)
        .where(
          and(
            eq(contributionPayout.contributionId, pot.id),
            isNotNull(contributionPayout.proofMediaId),
          ),
        ),
    ]);

    for (const e of entries) {
      if (!e.proofMediaId) continue;
      bytesFreed += await removeFile(pot.churchId, e.proofMediaId);
      await db
        .update(contributionEntry)
        .set({ proofMediaId: null, proofReleasedAt: now })
        .where(eq(contributionEntry.id, e.id));
      entriesReleased++;
    }
    for (const p of payouts) {
      if (!p.proofMediaId) continue;
      bytesFreed += await removeFile(pot.churchId, p.proofMediaId);
      await db
        .update(contributionPayout)
        .set({ proofMediaId: null, proofReleasedAt: now })
        .where(eq(contributionPayout.id, p.id));
      payoutsReleased++;
    }

    if (entries.length + payouts.length > 0) {
      await auditSystem({
        churchId: pot.churchId,
        actorName: "Storage housekeeping",
        action: "contributions.proof.release",
        summary: `Released ${entries.length + payouts.length} receipt ${entries.length + payouts.length === 1 ? "file" : "files"} from "${pot.title}", settled over a year ago. The record that each receipt existed is kept.`,
        targetType: "contribution",
        targetId: pot.id,
        targetLabel: pot.title,
      });
    }
  }

  const orphansRemoved = await sweepOrphanReceipts(now);

  return { entriesReleased, payoutsReleased, bytesFreed, orphansRemoved };
}

/**
 * Receipts nothing points at.
 *
 * Someone on the public form uploads a photo of a teller and then closes the tab
 * without pressing Submit. The file is already in storage and no row will ever
 * reference it. A day old and unreferenced is a safe test: an upload in progress
 * is minutes old, not hours.
 */
async function sweepOrphanReceipts(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 3_600_000);

  const candidates = await db
    .select({
      id: media.id,
      churchId: media.churchId,
      bytes: media.bytes,
      provider: media.provider,
      publicId: media.publicId,
      resourceType: media.resourceType,
    })
    .from(media)
    .where(and(eq(media.kind, "receipt"), lt(media.createdAt, cutoff)))
    .limit(300);
  if (candidates.length === 0) return 0;

  const ids = candidates.map((c) => c.id);

  /*
   * Two plain `inArray` queries rather than one `not exists` subquery. The raw
   * correlated form would lose its table qualifier inside a drizzle `sql`
   * template and match nothing — which here would mean deleting every receipt
   * in the batch, attached or not. The worst possible direction to fail in, so
   * the shape is avoided entirely (see AGENTS.md and src/lib/sql-safety.test.ts).
   */
  const [usedByEntries, usedByPayouts] = await Promise.all([
    db
      .select({ proofMediaId: contributionEntry.proofMediaId })
      .from(contributionEntry)
      .where(inArray(contributionEntry.proofMediaId, ids)),
    db
      .select({ proofMediaId: contributionPayout.proofMediaId })
      .from(contributionPayout)
      .where(inArray(contributionPayout.proofMediaId, ids)),
  ]);
  const attached = new Set(
    [...usedByEntries, ...usedByPayouts]
      .map((r) => r.proofMediaId)
      .filter((x): x is string => x !== null),
  );

  let removed = 0;
  for (const row of candidates) {
    if (attached.has(row.id)) continue;
    if (row.provider === "cloudinary" && row.publicId) {
      await destroyFromCloudinary(
        row.publicId,
        (row.resourceType as ResourceType) || "image",
      );
    }
    await db.delete(media).where(eq(media.id, row.id));
    removed++;
  }
  return removed;
}

/** Delete one receipt's file and row. Returns the bytes reclaimed. */
async function removeFile(churchId: string, mediaId: string): Promise<number> {
  const [row] = await db
    .select({
      id: media.id,
      bytes: media.bytes,
      provider: media.provider,
      publicId: media.publicId,
      resourceType: media.resourceType,
    })
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.churchId, churchId)))
    .limit(1);
  if (!row) return 0;

  if (row.provider === "cloudinary" && row.publicId) {
    // Catches internally and returns a boolean. A file left behind at the
    // provider reads as a storage figure slightly high, not a broken record,
    // and must not stop the row being cleared.
    await destroyFromCloudinary(
      row.publicId,
      (row.resourceType as ResourceType) || "image",
    );
  }
  await db.delete(media).where(eq(media.id, row.id));
  return row.bytes ?? 0;
}

/* ============================================================
 * Dates
 * ========================================================== */

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Whole days from `from` to `to`, both as YYYY-MM-DD.
 *
 * Flattened to UTC midnight so the answer is a calendar day count and not an
 * artefact of what time the cron happened to run. The same reasoning as
 * `daysUntil` in contributions-shared.ts, which is the version the UI uses and
 * which is unit-tested.
 */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}
