import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { devotional } from "@/db/schema";
import { sendDevotional } from "@/lib/devotionals";
import { withCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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
  const due = await db
    .select({ id: devotional.id })
    .from(devotional)
    .where(
      and(eq(devotional.status, "scheduled"), lte(devotional.scheduledAt, new Date())),
    )
    .limit(25);

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

  return new Response(JSON.stringify({ ok: true, processed: due.length, sent, recipients }), {
    headers: { "Content-Type": "application/json" },
  });
  });
}
