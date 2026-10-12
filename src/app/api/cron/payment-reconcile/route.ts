import { reconcilePendingPayments } from "@/lib/payment-reconcile";
import { withCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/payment-reconcile — every 15 minutes. Settles platform
 * Paystack checkouts (subscriptions and wallet/SMS top-ups) that are still
 * pending, in case the webhook and the browser callback both missed them,
 * and retries referral and Partner awards a settled payment still owes.
 * Auth via CRON_SECRET, as a bearer token or ?key=.
 *
 * Under withCronRun, so the command centre can tell "ran with nothing to do"
 * from "never ran" — the difference between a safety net and a picture of
 * one.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const key =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("key");
  if (!secret || key !== secret) return new Response("Unauthorized", { status: 401 });

  return withCronRun("payment-reconcile", async () => {
    const tally = await reconcilePendingPayments();
    return Response.json({ ok: true, ...tally });
  });
}
