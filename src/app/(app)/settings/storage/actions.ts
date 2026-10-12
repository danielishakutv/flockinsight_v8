"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { creditWallet, debitWallet } from "@/lib/wallet";
import { getStorageBundles } from "@/lib/pricing";
import { formatBytes, GB } from "@/lib/storage-bytes";
import { getStorageInfo } from "@/lib/storage";
import { storageSwitchQuote, type SwitchQuote } from "@/lib/storage-switch";
import { audit } from "@/lib/audit";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Subscribe to, or switch to, a storage bundle.
 *
 * With no add-on running, the first month is charged in full from the wallet.
 * A switch inside a paid month is settled on the difference for the days left
 * — charged on the way up, credited back on the way down — and the renewal
 * date stays put (lib/storage-switch.ts has the rule and why). It used to
 * charge a whole fresh month on every switch, keep nothing of the old one,
 * and happily shrink a church's storage below the files it already had.
 *
 * The church row is locked for the whole decision, so a double tap or two
 * tabs cannot both charge: the second one finds the bundle already switched.
 */
export async function subscribeStorage(gb: number): Promise<ActionResult> {
  const { church: c, user } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };

  // The bundle must be one we actually offer (prevents tampering).
  const bundles = await getStorageBundles();
  const bundle = bundles.find((b) => b.gb === gb);
  if (!bundle) return { ok: false, error: "That storage plan isn't available." };

  /*
   * Never below what is already stored: shrinking the quota under the files
   * a church holds blocks every upload until it deletes some, which is not a
   * cheaper plan so much as a broken one.
   */
  const info = await getStorageInfo(c.id, 0);
  const newLimit = info.limit + bundle.gb * GB;
  if (info.used > newLimit)
    return {
      ok: false,
      error: `You are using ${formatBytes(info.used)}, and +${bundle.gb}GB would hold ${formatBytes(newLimit)}. Free up space in Media first, or choose a bigger plan.`,
    };

  type Done = { quote: Exclude<SwitchQuote, { kind: "same" }>; fromGb: number };
  const result: { ok: true; done: Done } | { ok: false; error: string } = await db.transaction(
    async (tx) => {
      const [row] = await tx
        .select({
          extraBytes: church.storageExtraBytes,
          monthlyCost: church.storageMonthlyCost,
          renewsAt: church.storageRenewsAt,
        })
        .from(church)
        .where(eq(church.id, c.id))
        .for("update")
        .limit(1);
      if (!row) return { ok: false, error: "Church not found." };

      const fromGb = Math.round(Number(row.extraBytes) / GB);
      const quote = storageSwitchQuote(
        {
          currentGb: fromGb,
          currentMonthlyCost: Number(row.monthlyCost),
          renewsAt: row.renewsAt,
        },
        bundle,
      );
      // A stale tab, or the second of two taps: never charge for what is running.
      if (quote.kind === "same") return { ok: false, error: "You are already on this plan." };

      if (quote.kind === "downgrade") {
        if (quote.refund > 0)
          await creditWallet(
            {
              churchId: c.id,
              amount: quote.refund,
              category: "refund",
              reason: `Storage: +${fromGb}GB → +${bundle.gb}GB, unused part of this month returned`,
              createdBy: user.id,
            },
            tx,
          );
      } else if (quote.charge > 0) {
        const charged = await debitWallet(
          {
            churchId: c.id,
            amount: quote.charge,
            category: "storage",
            reason:
              quote.kind === "new"
                ? `Storage add-on: +${bundle.gb}GB (1 month)`
                : `Storage: +${fromGb}GB → +${bundle.gb}GB, difference for the rest of this month`,
            createdBy: user.id,
          },
          tx,
        );
        if (!charged.ok)
          return {
            ok: false,
            error: `Not enough wallet balance. This costs ₦${quote.charge.toLocaleString()} now — top up your wallet first.`,
          };
      }

      await tx
        .update(church)
        .set({
          storageExtraBytes: bundle.gb * GB,
          storageMonthlyCost: bundle.price,
          storageRenewsAt: quote.renewsAt,
        })
        .where(eq(church.id, c.id));
      return { ok: true, done: { quote, fromGb } };
    },
  );
  if (!result.ok) return result;
  const { quote, fromGb } = result.done;

  await audit({
    churchId: c.id,
    action: "billing.storage.create",
    summary:
      quote.kind === "new"
        ? `Subscribed to +${bundle.gb}GB of storage at ₦${bundle.price.toLocaleString()}/month`
        : quote.kind === "upgrade"
          ? `Switched storage +${fromGb}GB → +${bundle.gb}GB, ₦${quote.charge.toLocaleString()} for the rest of this month, then ₦${bundle.price.toLocaleString()}/month`
          : `Switched storage +${fromGb}GB → +${bundle.gb}GB, ₦${quote.refund.toLocaleString()} returned to the wallet, then ₦${bundle.price.toLocaleString()}/month`,
    targetType: "church",
    targetId: c.id,
    meta: {
      gb: bundle.gb,
      fromGb,
      price: bundle.price,
      kind: quote.kind,
      charge: quote.kind === "downgrade" ? 0 : quote.charge,
      refund: quote.kind === "downgrade" ? quote.refund : 0,
      renewsAt: quote.renewsAt.toISOString(),
    },
    severity: "notice",
  });

  revalidatePath("/settings/storage");
  revalidatePath("/media");
  return { ok: true };
}

/**
 * Cancel the storage add-on. Existing files are kept (nothing is deleted), but
 * uploads are blocked once usage exceeds the free base again. No refund.
 */
export async function cancelStorage(): Promise<ActionResult> {
  const { church: c } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };

  await db
    .update(church)
    .set({ storageExtraBytes: 0, storageMonthlyCost: 0, storageRenewsAt: null })
    .where(eq(church.id, c.id));

  await audit({
    churchId: c.id,
    action: "billing.storage.archive",
    summary:
      "Cancelled the storage add-on — files are kept, but uploads stop past the free base",
    targetType: "church",
    targetId: c.id,
    meta: { wasGb: Math.round(c.storageExtraBytes / (1024 * 1024 * 1024)) },
    severity: "warning",
  });

  revalidatePath("/settings/storage");
  revalidatePath("/media");
  return { ok: true };
}
