import { runServiceReminders } from "@/lib/service-reminders";
import { withCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/service-reminders — run hourly. Sends each church's configured
 * service-day reminders (email/SMS) to members, at most once per service
 * occurrence. Auth via ?key=CRON_SECRET or Bearer header.
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
    return await withCronRun("service-reminders", async () => {
      const summary = await runServiceReminders();
      return new Response(JSON.stringify({ ok: true, ...summary }), {
        headers: { "Content-Type": "application/json" },
      });
    });
  } catch (e) {
    console.error("[cron] service-reminders failed", e);
    return new Response(JSON.stringify({ ok: false, error: "failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
