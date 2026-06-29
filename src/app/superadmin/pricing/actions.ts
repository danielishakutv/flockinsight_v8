"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/session";
import { setPlanPrice, setStorageBundles } from "@/lib/pricing";
import { recordAudit } from "@/lib/audit";

export type ActionResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  starter: z.number().min(0).max(10_000_000),
  growth: z.number().min(0).max(10_000_000),
  pro: z.number().min(0).max(10_000_000),
});

export type PlanPriceInput = z.infer<typeof schema>;

export async function setPlanPrices(input: PlanPriceInput): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid price" };
  const d = parsed.data;

  await Promise.all([
    setPlanPrice("starter", d.starter),
    setPlanPrice("growth", d.growth),
    setPlanPrice("pro", d.pro),
  ]);

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "set_pricing",
    summary: `Updated plan prices — Starter ₦${d.starter}, Growth ₦${d.growth}, Pro ₦${d.pro}`,
  });

  // Refresh the public surfaces that show prices.
  revalidatePath("/");
  revalidatePath("/pricing");
  revalidatePath("/superadmin/pricing");
  return { ok: true };
}

const bundlesSchema = z
  .array(
    z.object({
      gb: z.number().int().min(1).max(10_000),
      price: z.number().min(0).max(10_000_000),
    }),
  )
  .max(8);

export type StorageBundleInput = z.infer<typeof bundlesSchema>;

export async function setStorageBundlesAction(
  input: StorageBundleInput,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const parsed = bundlesSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid bundle" };

  await setStorageBundles(parsed.data);

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "set_storage_pricing",
    summary: `Updated storage bundles — ${parsed.data
      .map((b) => `${b.gb}GB ₦${b.price}`)
      .join(", ")}`,
  });

  revalidatePath("/superadmin/pricing");
  revalidatePath("/settings/storage");
  return { ok: true };
}
