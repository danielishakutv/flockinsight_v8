import { revalidateTag } from "next/cache";
import { withCronRun } from "@/lib/cron-run";
import { snapshotTermiiBalance } from "@/lib/termii-balance";
import { getFloatOverviewFresh } from "@/lib/float";
import { syncAlerts } from "@/lib/platform-alerts";
import { recordMrrSnapshot } from "@/lib/platform-stats";
import { reconcileSenderIdsWithNetwork } from "@/lib/sender-id-reconcile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/platform-health — run every 30 minutes.
 *
 * Records the Termii master-wallet balance and the day's MRR, re-evaluates
 * every platform alert rule, notifies on newly-opened critical alerts, and
 * settles any sender ID the network has decided on.
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

  try {
    return await withCronRun("platform-health", async () => {
      const balance = await snapshotTermiiBalance();

      // Alerts must judge the reading just taken, not a cached one.
      const float = await getFloatOverviewFresh();
      const result = await syncAlerts(float);

      /*
       * Today's size and worth, kept so that in a year there is something to
       * compare against. Its own try/catch: a failure here is a gap in a
       * history nobody is reading yet, and must never cost the alert sync that
       * somebody is relying on right now.
       */
      let snapshot: Awaited<ReturnType<typeof recordMrrSnapshot>> | null = null;
      try {
        snapshot = await recordMrrSnapshot();
      } catch (e) {
        console.error("[cron/platform-health] mrr snapshot failed", e);
      }

      /*
       * Sender IDs the network has already decided on.
       *
       * Its own try/catch, and last, because it reaches a third party: a
       * Termii outage must not cost the float alerting above it, which is the
       * part somebody is relying on right now.
       *
       * Scheduled rather than left to a button because a sender ID is usually
       * approved on the Termii dashboard, with nothing here to hear about it.
       * One church sat approved-but-unable-to-send until somebody happened to
       * look. Half an hour is the longest that can now last.
       */
      let senderIds: Awaited<
        ReturnType<typeof reconcileSenderIdsWithNetwork>
      > | null = null;
      try {
        senderIds = await reconcileSenderIdsWithNetwork({
          id: null,
          name: "Automatic (network list)",
        });
        if (senderIds.ok && senderIds.approved.length > 0) {
          console.log(
            `[cron/platform-health] approved ${senderIds.approved.length} sender ID(s) from the network: ` +
              senderIds.approved.map((a) => a.senderId).join(", "),
          );
        }
        if (senderIds.ok && senderIds.contested.length > 0) {
          /* A church asking for a name that is not theirs. Never approved
           * automatically; said loudly because it may be a mistake or may not. */
          console.warn(
            `[cron/platform-health] REFUSED to approve ${senderIds.contested.length} sender ID(s) that belong elsewhere: ` +
              senderIds.contested
                .map((x) => `${x.name} wanted "${x.senderId}" (${x.reason})`)
                .join("; "),
          );
        }
        if (senderIds.ok && senderIds.declined.length > 0) {
          /* Not applied automatically -- see lib/sender-id-reconcile.ts. Said
           * out loud so it is not only visible to whoever opens the page. */
          console.warn(
            `[cron/platform-health] the network has DECLINED ${senderIds.declined.length} sender ID(s) still marked pending here: ` +
              senderIds.declined.map((d) => `${d.senderId} (${d.raw})`).join(", "),
          );
        }
        if (!senderIds.ok) {
          console.error(
            `[cron/platform-health] sender ID reconcile failed: ${senderIds.error}`,
          );
        }
      } catch (e) {
        console.error("[cron/platform-health] sender ID reconcile threw", e);
      }

      // The dashboard's cached float is now out of date. "max" gives
      // stale-while-revalidate; the bare one-argument form is deprecated in
      // Next 16.
      revalidateTag("float", "max");

      return new Response(
        JSON.stringify({
          ok: true,
          balance: balance.ok ? balance.balance : null,
          balanceError: balance.ok ? null : balance.error,
          snapshot,
          senderIds: senderIds?.ok
            ? {
                approved: senderIds.approved.length,
                renamed: senderIds.renamed.length,
                declined: senderIds.declined.length,
                contested: senderIds.contested.length,
                stillWaiting: senderIds.stillWaiting,
              }
            : { error: senderIds?.error ?? "threw" },
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
