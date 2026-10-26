import { withCronRun } from "@/lib/cron-run";
import { runAssistantRetention } from "@/lib/assistant/retention";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/assistant-retention, daily. Keeps the promises the
 * assistant's privacy line makes (lib/assistant/retention.ts has them in
 * full): a conversation goes 180 days after its last message unless an
 * answer in it was saved, a conversation the person deleted goes for good 30
 * days later, and the AI ledger's stored copy of an assistant question goes
 * with its conversation, or after 180 days at the latest (its cost and
 * tokens stay).
 *
 * Batched so one run never holds a long lock; anything left over goes on the
 * next day's run, and the counts are on the cron_run row either way.
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

  return withCronRun("assistant-retention", async () => {
    const r = await runAssistantRetention();
    // `deleted` is kept from the old summary so the cron history reads on.
    return Response.json({ ok: true, deleted: r.expired + r.removed, ...r });
  });
}
