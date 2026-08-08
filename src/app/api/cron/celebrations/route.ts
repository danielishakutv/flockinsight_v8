import { runCelebrations } from "@/lib/celebrations";
import { withCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/celebrations — run hourly. Sends birthday & anniversary
 * messages due today. Auth via ?key=CRON_SECRET or Bearer header.
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
  // The throw must reach withCronRun so the failure is recorded, so it is
  // caught outside the heartbeat rather than inside it.
  try {
    return await withCronRun("celebrations", async () => {
      const summary = await runCelebrations();
      return new Response(JSON.stringify({ ok: true, ...summary }), {
        headers: { "Content-Type": "application/json" },
      });
    });
  } catch (e) {
    console.error("[cron] celebrations failed", e);
    return new Response(JSON.stringify({ ok: false, error: "failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
