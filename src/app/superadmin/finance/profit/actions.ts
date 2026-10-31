"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { church, payment, platformCostItem, platformIncomeEntry, walletTopup } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requirePlatform } from "@/lib/platform-access";
import { rateLimit } from "@/lib/rate-limit";
import { setSetting } from "@/lib/platform-settings";
import { paystackVerify } from "@/lib/paystack";
import { isPaystackConfigured } from "@/lib/paystack";
import { dollarRate, NGN_PER_USD_KEY } from "@/lib/cost-to-serve";
import { buildFinancePayload } from "@/lib/ai/finance-facts";
import { generateFinanceSummary } from "@/lib/ai/summaries";
import type { PlatformSummaryView, UiReason } from "@/lib/ai/ai-shared";
import { COST_CATEGORIES, COST_DRIVERS, FREQUENCIES, INCOME_CATEGORIES, incomeDef } from "@/lib/cost-to-serve-shared";

/*
 * Writes for the cost & profit page. Nothing here deletes: a cost that stops
 * is ended on a date (its past months keep it), one typed by mistake is
 * archived, and income is voided with a reason. Every write is audited.
 */

export type ProfitResult = { ok: true; message?: string } | { ok: false; error: string };

const PAGE = "/superadmin/finance/profit";
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const currency = z.enum(["NGN", "USD"]);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const itemSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, "Name the cost").max(120),
    vendor: text(120),
    category: z.enum(COST_CATEGORIES.map((c) => c.key) as [string, ...string[]]),
    amount: z.number().min(0, "Enter what it costs").max(1_000_000_000),
    currency,
    frequency: z.enum(FREQUENCIES),
    startsOn: day,
    endsOn: day.nullable().optional(),
    spreadMonths: z.number().int().min(1).max(120).nullable().optional(),
    purpose: text(500),
    driver: z.enum(COST_DRIVERS),
    channel: text(40),
  })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, { message: "It cannot end before it starts", path: ["endsOn"] })
  .refine((v) => v.frequency === "one_off" || !v.spreadMonths, { message: "Only a one-off can be spread", path: ["spreadMonths"] });

export async function saveCostItem(input: z.input<typeof itemSchema>): Promise<ProfitResult> {
  const admin = await requirePlatform("platform.finance.manage");
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
  const d = parsed.data;
  const values = {
    name: d.name,
    vendor: d.vendor,
    category: d.category,
    amount: d.amount,
    currency: d.currency,
    frequency: d.frequency,
    startsOn: d.startsOn,
    endsOn: d.frequency === "one_off" ? null : (d.endsOn ?? null),
    spreadMonths: d.frequency === "one_off" ? (d.spreadMonths ?? null) : null,
    purpose: d.purpose,
    driver: d.driver,
    channel: d.category === "marketing" ? (d.channel?.toLowerCase() ?? null) : null,
  };
  const price = `${d.currency === "USD" ? "$" : "₦"}${d.amount.toLocaleString()} ${d.frequency.replace("_", "-")}`;

  if (d.id) {
    const updated = await db
      .update(platformCostItem)
      .set(values)
      .where(and(eq(platformCostItem.id, d.id), isNull(platformCostItem.archivedAt)))
      .returning({ id: platformCostItem.id });
    if (updated.length !== 1) return { ok: false, error: "That cost no longer exists, or was archived." };
    await recordAudit({
      actorUserId: admin.id,
      actorName: admin.name,
      action: "costs.item.update",
      summary: `Changed the cost "${d.name}" (${price})`,
      targetType: "platform_cost_item",
      targetId: d.id,
      targetLabel: d.name,
      meta: values,
    });
  } else {
    const [row] = await db
      .insert(platformCostItem)
      .values({ ...values, createdBy: admin.id })
      .returning({ id: platformCostItem.id });
    await recordAudit({
      actorUserId: admin.id,
      actorName: admin.name,
      action: "costs.item.create",
      summary: `Added the cost "${d.name}" (${price})`,
      targetType: "platform_cost_item",
      targetId: row.id,
      targetLabel: d.name,
      meta: values,
    });
  }
  revalidatePath(PAGE);
  return { ok: true };
}

/**
 * A price change, the honest way: the old price ends the day before, and the
 * same cost starts again at the new one. Editing the amount in place would
 * reprice every past month too.
 */
export async function changeCostPrice(input: { id: string; amount: number; currency: "NGN" | "USD"; from: string }): Promise<ProfitResult> {
  const admin = await requirePlatform("platform.finance.manage");
  const parsed = z
    .object({ id: z.string().uuid(), amount: z.number().min(0).max(1_000_000_000), currency, from: day })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
  const d = parsed.data;
  const [old] = await db
    .select()
    .from(platformCostItem)
    .where(and(eq(platformCostItem.id, d.id), isNull(platformCostItem.archivedAt)))
    .limit(1);
  if (!old) return { ok: false, error: "That cost no longer exists." };
  if (old.frequency === "one_off") return { ok: false, error: "A one-off has no price to change. Edit it instead." };
  if (d.from <= old.startsOn) return { ok: false, error: "Pick a date after it started. To correct the original price, edit it instead." };
  if (old.endsOn && d.from > old.endsOn) return { ok: false, error: "That cost had already ended by then." };

  const dayBefore = new Date(`${d.from}T00:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const endsOld = dayBefore.toISOString().slice(0, 10);

  const newId = await db.transaction(async (tx) => {
    const ended = await tx
      .update(platformCostItem)
      .set({ endsOn: endsOld })
      .where(and(eq(platformCostItem.id, old.id), isNull(platformCostItem.archivedAt)))
      .returning({ id: platformCostItem.id });
    if (ended.length !== 1) throw new Error("The cost changed while this was saving. Reload and try again.");
    const [row] = await tx
      .insert(platformCostItem)
      .values({
        name: old.name,
        vendor: old.vendor,
        category: old.category,
        amount: d.amount,
        currency: d.currency,
        frequency: old.frequency,
        startsOn: d.from,
        endsOn: old.endsOn,
        spreadMonths: null,
        purpose: old.purpose,
        driver: old.driver,
        channel: old.channel,
        createdBy: admin.id,
      })
      .returning({ id: platformCostItem.id });
    return row.id;
  });
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "costs.item.reprice",
    summary: `"${old.name}" now costs ${d.currency === "USD" ? "$" : "₦"}${d.amount.toLocaleString()} from ${d.from} (was ${old.currency === "USD" ? "$" : "₦"}${Number(old.amount).toLocaleString()})`,
    targetType: "platform_cost_item",
    targetId: newId,
    targetLabel: old.name,
  });
  revalidatePath(PAGE);
  return { ok: true };
}

/** Stop paying for something. The months it was paid for keep it. */
export async function endCostItem(input: { id: string; endsOn: string }): Promise<ProfitResult> {
  const admin = await requirePlatform("platform.finance.manage");
  const parsed = z.object({ id: z.string().uuid(), endsOn: day }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick the last day it was paid for." };
  const [old] = await db.select().from(platformCostItem).where(eq(platformCostItem.id, parsed.data.id)).limit(1);
  if (!old || old.archivedAt) return { ok: false, error: "That cost no longer exists." };
  if (parsed.data.endsOn < old.startsOn) return { ok: false, error: "It cannot end before it started." };
  await db.update(platformCostItem).set({ endsOn: parsed.data.endsOn }).where(eq(platformCostItem.id, old.id));
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "costs.item.end",
    summary: `"${old.name}" ends on ${parsed.data.endsOn}`,
    targetType: "platform_cost_item",
    targetId: old.id,
    targetLabel: old.name,
  });
  revalidatePath(PAGE);
  return { ok: true };
}

/** Typed by mistake: out of every figure, kept in the table and the audit trail. */
export async function archiveCostItem(input: { id: string; reason: string }): Promise<ProfitResult> {
  const admin = await requirePlatform("platform.finance.manage");
  const reason = (input.reason ?? "").trim().slice(0, 200);
  if (!reason) return { ok: false, error: "Say why it is being taken out." };
  const archived = await db
    .update(platformCostItem)
    .set({ archivedAt: new Date() })
    .where(and(eq(platformCostItem.id, input.id), isNull(platformCostItem.archivedAt)))
    .returning({ name: platformCostItem.name });
  if (archived.length !== 1) return { ok: false, error: "That cost was already taken out." };
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "costs.item.archive",
    summary: `Took "${archived[0].name}" out of the costs: ${reason}`,
    targetType: "platform_cost_item",
    targetId: input.id,
    targetLabel: archived[0].name,
    severity: "warning",
  });
  revalidatePath(PAGE);
  return { ok: true };
}

const incomeSchema = z
  .object({
    receivedOn: day,
    category: z.enum(INCOME_CATEGORIES.map((c) => c.key) as [string, ...string[]]),
    amount: z.number().positive("Enter the amount").max(1_000_000_000),
    currency,
    /** What landed in naira, for money that arrived in dollars. Worked out at today's rate when blank. */
    amountNgn: z.number().positive().max(10_000_000_000).nullable().optional(),
    source: text(120),
    churchId: z.string().min(1).nullable().optional(),
    reference: text(120),
    description: text(300),
  })
  .refine((v) => !incomeDef(v.category).needsChurch || !!v.churchId, { message: "Pick the church that paid", path: ["churchId"] });

export async function addIncome(input: z.input<typeof incomeSchema>): Promise<ProfitResult> {
  const admin = await requirePlatform("platform.finance.manage");
  const parsed = incomeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
  const d = parsed.data;
  let churchName: string | null = null;
  if (d.churchId) {
    const [c] = await db.select({ name: church.name }).from(church).where(eq(church.id, d.churchId)).limit(1);
    if (!c) return { ok: false, error: "That church no longer exists." };
    churchName = c.name;
  }
  const amountNgn = d.currency === "NGN" ? d.amount : (d.amountNgn ?? d.amount * (await dollarRate()).ngnPerUsd);
  const [row] = await db
    .insert(platformIncomeEntry)
    .values({
      receivedOn: d.receivedOn,
      category: d.category,
      amount: d.amount,
      currency: d.currency,
      amountNgn: Math.round(amountNgn * 100) / 100,
      source: d.source,
      churchId: d.churchId ?? null,
      reference: d.reference,
      description: d.description,
      createdBy: admin.id,
    })
    .returning({ id: platformIncomeEntry.id });
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "costs.income.create",
    summary: `Recorded ₦${Math.round(amountNgn).toLocaleString()} income (${incomeDef(d.category).label})${churchName ? ` from ${churchName}` : d.source ? ` from ${d.source}` : ""}`,
    targetType: "platform_income_entry",
    targetId: row.id,
    churchId: d.churchId ?? null,
  });
  revalidatePath(PAGE);
  return { ok: true };
}

export async function voidIncome(input: { id: string; reason: string }): Promise<ProfitResult> {
  const admin = await requirePlatform("platform.finance.manage");
  const reason = (input.reason ?? "").trim().slice(0, 200);
  if (!reason) return { ok: false, error: "Say why it is being voided." };
  const voided = await db
    .update(platformIncomeEntry)
    .set({ voidedAt: new Date(), voidReason: reason })
    .where(and(eq(platformIncomeEntry.id, input.id), isNull(platformIncomeEntry.voidedAt)))
    .returning({ amountNgn: platformIncomeEntry.amountNgn });
  if (voided.length !== 1) return { ok: false, error: "That entry was already voided." };
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "costs.income.void",
    summary: `Voided ₦${Math.round(Number(voided[0].amountNgn)).toLocaleString()} of income: ${reason}`,
    targetType: "platform_income_entry",
    targetId: input.id,
    severity: "warning",
  });
  revalidatePath(PAGE);
  return { ok: true };
}

/** What a dollar costs the operator in naira. Blank goes back to the market rate. */
export async function setDollarRate(input: { ngnPerUsd: number | null }): Promise<ProfitResult> {
  const admin = await requirePlatform("platform.finance.manage");
  const v = input.ngnPerUsd;
  if (v != null && !(Number.isFinite(v) && v >= 100 && v <= 100_000)) return { ok: false, error: "Enter naira per dollar, e.g. 1650." };
  await setSetting(NGN_PER_USD_KEY, v == null ? "" : String(v));
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "costs.rate.set",
    summary: v == null ? "Dollar costs now use the market rate" : `Dollar costs now use ₦${v.toLocaleString()} per $`,
  });
  revalidatePath(PAGE);
  return { ok: true };
}

const FEE_BATCH = 40;

/**
 * Ask Paystack what it actually kept on payments from before the fee was
 * stored, a batch at a time, oldest first. Reads only: a verify never
 * changes a payment, and only an empty fee column is filled.
 */
export async function fetchPaystackFees(): Promise<ProfitResult> {
  const admin = await requirePlatform("platform.finance.manage");
  if (!isPaystackConfigured()) return { ok: false, error: "Paystack is not configured on this server." };
  const rl = rateLimit(`paystack-fees:${admin.id}`, 3, 60_000);
  if (!rl.ok) return { ok: false, error: `Wait ${rl.retryAfterSec} s before the next batch.` };

  const [payments, topups] = await Promise.all([
    db
      .select({ id: payment.id, reference: payment.reference })
      .from(payment)
      .where(and(eq(payment.status, "success"), eq(payment.gateway, "paystack"), isNull(payment.gatewayFee)))
      .orderBy(asc(payment.createdAt))
      .limit(FEE_BATCH),
    db
      .select({ id: walletTopup.id, reference: walletTopup.reference })
      .from(walletTopup)
      .where(and(eq(walletTopup.status, "success"), isNull(walletTopup.gatewayFee)))
      .orderBy(asc(walletTopup.createdAt))
      .limit(FEE_BATCH),
  ]);
  let filled = 0;
  let missing = 0;
  let failed = 0;
  for (const p of [...payments.map((r) => ({ ...r, table: "payment" as const })), ...topups.map((r) => ({ ...r, table: "topup" as const }))].slice(0, FEE_BATCH)) {
    const v = await paystackVerify(p.reference);
    if (!v.ok) {
      failed++;
      console.error(`[costs] could not fetch the Paystack fee for ${p.reference}: ${v.error}`);
      continue;
    }
    if (v.feesKobo == null) {
      missing++;
      continue;
    }
    const fee = v.feesKobo / 100;
    if (p.table === "payment")
      await db.update(payment).set({ gatewayFee: fee }).where(and(eq(payment.id, p.id), isNull(payment.gatewayFee)));
    else await db.update(walletTopup).set({ gatewayFee: fee }).where(and(eq(walletTopup.id, p.id), isNull(walletTopup.gatewayFee)));
    filled++;
  }
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "costs.fees.fetch",
    summary: `Fetched Paystack's actual fee for ${filled} payment${filled === 1 ? "" : "s"}${failed ? `; ${failed} could not be reached` : ""}${missing ? `; ${missing} had no fee in Paystack's answer` : ""}`,
  });
  revalidatePath(PAGE);
  const total = payments.length + topups.length;
  if (total === 0) return { ok: true, message: "Every Paystack payment already has its actual fee." };
  if (failed > 0)
    return { ok: false, error: `${filled} fetched, ${failed} could not reach Paystack. The server log has each reference; try again in a minute.` };
  return {
    ok: true,
    message: `${filled} fee${filled === 1 ? "" : "s"} fetched${missing ? `, ${missing} without a fee in Paystack's answer` : ""}${total >= FEE_BATCH ? ". Run it again for the next batch." : "."}`,
  };
}

export type FinanceBriefingResult =
  | { ok: true; view: PlatformSummaryView }
  | { ok: false; reason?: UiReason; error: string };

export async function generateFinanceBriefing(): Promise<FinanceBriefingResult> {
  const access = await requirePlatform("platform.finance.view");
  const rl = rateLimit(`ai-finance:${access.id}`, 5, 60_000);
  if (!rl.ok) return { ok: false, reason: "too_fast", error: `Too many tries. Wait ${rl.retryAfterSec} s.` };
  const res = await generateFinanceSummary(access.id, () => buildFinancePayload());
  revalidatePath(PAGE);
  return res.ok ? { ok: true, view: res.view } : { ok: false, reason: res.reason, error: res.message };
}
