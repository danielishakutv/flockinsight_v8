import { and, eq, gt, lte, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { debitWallet } from "@/lib/wallet";
import { notifyChurchManagers } from "@/lib/notifications";
import { formatMoney } from "@/lib/money";
import { withCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function addMonth(from: Date): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d;
}

/**
 * GET /api/cron/storage — run daily. Charges each church's monthly storage
 * add-on from its wallet. If the wallet can't cover it, the add-on lapses
 * (files are kept; uploads are blocked once over the free base) and the church
 * is notified. Auth via ?key=CRON_SECRET or Bearer header.
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

  return withCronRun("storage", async () => {
  const now = new Date();
  const due = await db
    .select({
      id: church.id,
      cost: church.storageMonthlyCost,
      renewsAt: church.storageRenewsAt,
      currency: church.currency,
    })
    .from(church)
    .where(
      and(
        gt(church.storageMonthlyCost, 0),
        isNotNull(church.storageRenewsAt),
        lte(church.storageRenewsAt, now),
      ),
    )
    .limit(200);

  let renewed = 0;
  let lapsed = 0;

  for (const c of due) {
    // Advance the renewal date to a future point (catch up if we missed runs).
    let next = addMonth(c.renewsAt ?? now);
    while (next <= now) next = addMonth(next);

    const charge = await debitWallet({
      churchId: c.id,
      amount: c.cost,
      category: "storage",
      reason: "Storage add-on renewal",
    });

    if (charge.ok) {
      await db
        .update(church)
        .set({ storageRenewsAt: next })
        .where(eq(church.id, c.id));
      renewed++;
    } else {
      await db
        .update(church)
        .set({ storageExtraBytes: 0, storageMonthlyCost: 0, storageRenewsAt: null })
        .where(eq(church.id, c.id));
      lapsed++;
      await notifyChurchManagers({
        churchId: c.id,
        title: "Storage add-on paused",
        body: `We couldn't renew your storage add-on (${formatMoney(c.cost, c.currency)}/mo) — your wallet was too low. Your files are safe, but you'll need to top up and re-subscribe to keep uploading beyond 200MB.`,
        linkUrl: "/settings/storage",
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, renewed, lapsed }), {
    headers: { "Content-Type": "application/json" },
  });
  });
}
