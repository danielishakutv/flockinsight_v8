"use server";

import { revalidatePath, updateTag } from "next/cache";
import { requireSuperAdmin } from "@/lib/session";
import { snapshotTermiiBalance } from "@/lib/termii-balance";
import {
  setSetting,
  TERMII_UNIT_COST_KEY,
  TERMII_UNIT_COST_MODE_KEY,
} from "@/lib/platform-settings";

/** Take a fresh Termii reading and drop the cached float. */
export async function refreshFloat(): Promise<void> {
  await requireSuperAdmin();
  await snapshotTermiiBalance();
  // updateTag expires immediately, which is what a manual Refresh should do.
  updateTag("float");
  revalidatePath("/superadmin/health");
}

export async function saveUnitCost(
  value: string,
  mode: "manual" | "auto",
): Promise<{ ok: boolean; error?: string }> {
  await requireSuperAdmin();

  const trimmed = value.trim();
  if (mode === "manual") {
    if (!trimmed) return { ok: false, error: "Enter a cost per page." };
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, error: "Cost must be a number greater than zero." };
    }
    await setSetting(TERMII_UNIT_COST_KEY, String(n));
  }

  await setSetting(TERMII_UNIT_COST_MODE_KEY, mode);
  updateTag("float");
  revalidatePath("/superadmin/health");
  return { ok: true };
}
