import { revalidateTag } from "next/cache";
import { withCronRun } from "@/lib/cron-run";
import { snapshotTermiiBalance } from "@/lib/termii-balance";
import { getFloatOverviewFresh } from "@/lib/float";
import { syncAlerts } from "@/lib/platform-alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/platform-health — run every 30 minutes. Records the Termii
 * master-wallet balance, re-evaluates every platform alert rule, and notifies
 * on newly-opened critical alerts. Auth via ?key=CRON_SECRET or Bearer header.
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
    return await withCronRun("platform-health", async () => {
      const balance = await snapshotTermiiBalance();

      // Alerts must judge the reading just taken, not a cached one.
      const float = await getFloatOverviewFresh();
      const result = await syncAlerts(float);

      // The dashboard's cached float is now out of date. "max" gives
      // stale-while-revalidate; the bare one-argument form is deprecated in
      // Next 16.
      revalidateTag("float", "max");

      return new Response(
        JSON.stringify({
          ok: true,
          balance: balance.ok ? balance.balance : null,
          balanceError: balance.ok ? null : balance.error,
          ...result,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
  } catch (e) {
    console.error("[cron] platform-health failed", e);
    return new Response(JSON.stringify({ ok: false, error: "failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
