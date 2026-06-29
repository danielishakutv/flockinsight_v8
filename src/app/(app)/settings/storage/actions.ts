"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { debitWallet } from "@/lib/wallet";
import { getStorageBundles } from "@/lib/pricing";
import { GB } from "@/lib/storage-bytes";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Add one month and return the new date. */
function addMonth(from: Date): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d;
}

/**
 * Subscribe to (or switch to) a storage bundle. Charges the first month from
 * the wallet immediately and activates the extra storage. Switching bundles
 * charges a fresh month and resets the renewal date.
 */
export async function subscribeStorage(gb: number): Promise<ActionResult> {
  const { church: c, user } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };

  // The bundle must be one we actually offer (prevents tampering).
  const bundles = await getStorageBundles();
  const bundle = bundles.find((b) => b.gb === gb);
  if (!bundle) return { ok: false, error: "That storage plan isn't available." };

  const charge = await debitWallet({
    churchId: c.id,
    amount: bundle.price,
    category: "storage",
    reason: `Storage add-on: +${bundle.gb}GB (1 month)`,
    createdBy: user.id,
  });
  if (!charge.ok)
    return {
      ok: false,
      error: `Not enough wallet balance. This costs ₦${bundle.price.toLocaleString()} — top up your wallet first.`,
    };

  await db
    .update(church)
    .set({
      storageExtraBytes: bundle.gb * GB,
      storageMonthlyCost: bundle.price,
      storageRenewsAt: addMonth(new Date()),
    })
    .where(eq(church.id, c.id));

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

  revalidatePath("/settings/storage");
  revalidatePath("/media");
  return { ok: true };
}
