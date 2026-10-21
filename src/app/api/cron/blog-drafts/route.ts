import { withCronRun } from "@/lib/cron-run";
import { isoWeekKey } from "@/lib/blog-draft-shared";
import { blogDraftingReady, claimScheduledWeek, executeDraftRun } from "@/lib/blog-drafts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/blog-drafts, run DAILY at 05:00 UTC. Weekly in effect: the
 * job claims the ISO week on blog_draft_run's partial unique index, so the
 * first tick of a week drafts, a failed draft is retried on the next two
 * ticks, and every other tick is one INSERT that conflicts and does nothing.
 *
 * Dormant (no key, kill switch, paused) and already-drafted ticks are
 * successful runs that say why in their JSON, which cron_run.meta keeps. A
 * model or parse failure is recorded on the run row and then THROWN, so
 * cron_run.ok is false and the health page shows the cause.
 * Auth via ?key=CRON_SECRET or a Bearer header.
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

  return withCronRun("blog-drafts", async () => {
    const ready = await blogDraftingReady();
    if (!ready.ready) return Response.json({ ok: true, skipped: ready.message });

    const week = isoWeekKey(new Date());
    const runId = await claimScheduledWeek(week);
    if (!runId) {
      return Response.json({
        ok: true,
        week,
        skipped: "This week's draft is already done or in progress.",
      });
    }

    const outcome = await executeDraftRun(runId);
    if (outcome.status === "drafted") {
      return Response.json({ ok: true, week, drafted: true, topic: outcome.topic, postId: outcome.postId });
    }
    if (outcome.status === "skipped") {
      return Response.json({ ok: true, week, skipped: outcome.error });
    }
    throw new Error(`Blog draft for ${week} failed: ${outcome.error}`);
  });
}
