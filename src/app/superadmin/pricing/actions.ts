"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/session";
import { setPlanPrice } from "@/lib/pricing";

export type ActionResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  starter: z.number().min(0).max(10_000_000),
  growth: z.number().min(0).max(10_000_000),
  pro: z.number().min(0).max(10_000_000),
});

export type PlanPriceInput = z.infer<typeof schema>;

export async function setPlanPrices(input: PlanPriceInput): Promise<ActionResult> {
  await requireSuperAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid price" };
  const d = parsed.data;

  await Promise.all([
    setPlanPrice("starter", d.starter),
    setPlanPrice("growth", d.growth),
    setPlanPrice("pro", d.pro),
  ]);

  // Refresh the public surfaces that show prices.
  revalidatePath("/");
  revalidatePath("/pricing");
  revalidatePath("/superadmin/pricing");
  return { ok: true };
}
