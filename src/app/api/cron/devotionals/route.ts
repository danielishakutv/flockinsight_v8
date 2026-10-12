import { and, asc, count, eq, gte, lt, lte, not } from "drizzle-orm";
import { db } from "@/db";
import { church, devotional } from "@/db/schema";
import { auditSystem } from "@/lib/audit";
import { inGoodStandingSql } from "@/lib/church-standing";
import { sendDevotional } from "@/lib/devotionals";
import { withCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/*
 * How late a scheduled devotional may still go out. Past this it is no longer
 * "Monday's devotional", it is one of a pile: a church that queued a month of
 * dailies and then lapsed for three weeks would, on the first run after it
 * paid, send its members twenty-one of them at once, oldest first. So a
 * devotional this late is returned to draft for the church to reschedule or
 * delete, and never sent by the cron. The same holds after a cron outage.
 */
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

/**
 * GET /api/cron/devotionals — run every few minutes. Sends any scheduled
 * devotionals/newsletters whose time has come. Auth via ?key=CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const key =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("key");
  if (!secret || key !== secret)
    return new Response("Unauthorized", { status: 401 });

  return withCronRun("devotionals", async () => {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);

    // Too late to send: back to draft, said in each church's activity log so
    // the editor who scheduled it can see why it never went.
    const returned = await db
      .update(devotional)
      .set({ status: "draft" })
      .where(and(eq(devotional.status, "scheduled"), lt(devotional.scheduledAt, staleBefore)))
      .returning({ id: devotional.id, churchId: devotional.churchId, title: devotional.title });
    const returnedByChurch = new Map<string, string[]>();
    for (const r of returned) {
      const titles = returnedByChurch.get(r.churchId) ?? [];
      titles.push(r.title);
      returnedByChurch.set(r.churchId, titles);
    }
    for (const [churchId, titles] of returnedByChurch) {
      console.warn(
        `[cron/devotionals] ${titles.length} devotional(s) for church ${churchId} were over 48 hours late; returned to draft`,
      );
      await auditSystem({
        churchId,
        action: "devotionals.item.unschedule",
        summary:
          titles.length === 1
            ? `"${titles[0]}" was more than 48 hours past its scheduled time, so it was not sent and is back in drafts to reschedule`
            : `${titles.length} devotionals were more than 48 hours past their scheduled time, so they were not sent and are back in drafts to reschedule`,
        targetType: "devotional",
        meta: { titles: titles.slice(0, 20), count: titles.length },
        severity: "notice",
      });
    }

    // Due, and not too late. The lower bound repeats the cut-off above so a
    // row can never be both returned to draft and picked up to send.
    const isDue = and(
      eq(devotional.status, "scheduled"),
      lte(devotional.scheduledAt, now),
      gte(devotional.scheduledAt, staleBefore),
    );

    /*
     * Only churches in good standing.
     *
     * A devotional queued during a trial used to go out after the trial ended,
     * to every member and subscriber, on the platform's email — the paywall
     * stopped the church opening the app but not the app sending for it. A
     * paused church's devotional is left "scheduled", not claimed and not
     * failed, so it goes out once the church is back in good standing — or,
     * if that takes more than 48 hours, is returned to draft above.
     *
     * In the WHERE, not checked per row after a fetch: this takes 25 at a time,
     * and a backlog belonging to lapsed churches would fill every batch and
     * starve the ones that pay. Oldest first for the same reason — a fixed
     * order means nothing waits behind newer work for ever.
     */
    const due = await db
      .select({ id: devotional.id })
      .from(devotional)
      .innerJoin(church, eq(church.id, devotional.churchId))
      .where(and(isDue, inGoodStandingSql(now)))
      .orderBy(asc(devotional.scheduledAt))
      .limit(25);

    // Said out loud in the heartbeat rather than skipped silently, so "nothing
    // was sent" and "something is being held" read differently.
    const [{ held }] = await db
      .select({ held: count() })
      .from(devotional)
      .innerJoin(church, eq(church.id, devotional.churchId))
      .where(and(isDue, not(inGoodStandingSql(now))));

    let sent = 0;
    let recipients = 0;
    for (const d of due) {
      // sendDevotional claims the row atomically, so this is concurrency-safe.
      const res = await sendDevotional(d.id);
      if (res.ok) {
        sent += res.sent;
        recipients += res.recipients;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed: due.length,
        sent,
        recipients,
        heldForLapsedChurches: Number(held),
        staleReturnedToDraft: returned.length,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  });
}
