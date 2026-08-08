import { runFirstTimers } from "@/lib/first-timers";
import { withCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/first-timers — run daily. Sends the first-timer welcome and
 * "become a member" invite messages that are due. Idempotent per member per
 * stage. Auth via ?key=CRON_SECRET or Bearer header.
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
