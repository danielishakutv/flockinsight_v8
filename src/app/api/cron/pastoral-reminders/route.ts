import { runPastoralReminders } from "@/lib/pastoral-reminders";
import { withCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/pastoral-reminders, every five minutes. Sends the reminder
 * for each confirmed pastoral appointment whose remind_at has come, at most
 * once per appointment. Auth via ?key=CRON_SECRET or Bearer header.
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

  try {
    return await withCronRun("pastoral-reminders", async () => {
      const summary = await runPastoralReminders();
      return new Response(JSON.stringify({ ok: true, ...summary }), {
        headers: { "Content-Type": "application/json" },
      });
    });
  } catch (e) {
    console.error("[cron] pastoral-reminders failed", e);
    return new Response(JSON.stringify({ ok: false, error: "failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
