import { runFirstTimers } from "@/lib/first-timers";
import { withCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/first-timers — RUN HOURLY.
 *
 * Sends the first-timer welcome and "become a member" invite messages that are
 * due. Hourly rather than daily because each church sets its own local send
 * time and the sweep only acts once that hour has come round where the church
 * is; a daily sweep at a fixed UTC hour could never reach most of them. That
 * gate is also what keeps the SMS inside the 8am-8pm delivery window.
 *
 * Idempotent per member per stage per channel, so running it often is cheap
 * and running it twice sends nothing twice.
 *
 * Auth via an `Authorization: Bearer <CRON_SECRET>` header, or `?key=` —
 * prefer the header, because a query string is written to the access log.
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

  return withCronRun("first-timers", async () => {
    const result = await runFirstTimers();
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { "Content-Type": "application/json" },
    });
  });
}
