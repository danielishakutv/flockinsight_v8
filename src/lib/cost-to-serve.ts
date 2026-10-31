import "server-only";
import { and, eq, gte, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aiCall,
  church,
  lead,
  media,
  meeting,
  meetingParticipant,
  member,
  partnerEarning,
  partnerReferral,
  payment,
  platformCostItem,
  platformIncomeEntry,
  smsTopup,
  staff,
  termiiSnapshot,
  usageStat,
  userActiveDay,
  walletTopup,
  walletTxn,
} from "@/db/schema";
import { notVoided } from "@/lib/billing";
import { getFloatOverview } from "@/lib/float";
import { getRates, rateFor } from "@/lib/fx";
import { getSetting, getSmsPrice } from "@/lib/platform-settings";
import { isTermiiConfigured } from "@/lib/termii-balance";
import { listCustomPlans } from "@/lib/plan-catalog";
import { planName } from "@/lib/plans";
import {
  buildCostReport,
  categoryDef,
  monthOf,
  monthRange,
  addMonths,
  monthLabel,
  termiiSpendByMonth,
  type ChurchInput,
  type CostDriver,
  type CostInputs,
  type CostReport,
  type Frequency,
  type MonthKey,
} from "@/lib/cost-to-serve-shared";
import type { InsightContext } from "@/lib/cost-insights-shared";

/**
 * Reads everything the cost page needs and hands it to buildCostReport.
 *
 * Every query here is a grouped aggregate, joined in JS. A correlated
 * subquery in a raw `sql` template drops its table qualifier when the query
 * has no join and silently counts zero (AGENTS.md), and a money page that
 * silently reads zero is worse than one that fails.
 *
 * The demo church is left out of everything: it is wiped every two hours and
 * none of its activity is anybody's money.
 */

/** "What naira per dollar does your bank actually charge you?" */
export const NGN_PER_USD_KEY = "finance_ngn_per_usd";

export type PeriodKey = "this" | "last" | "3m" | "ytd" | "12m";

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "this", label: "This month" },
  { key: "last", label: "Last month" },
  { key: "3m", label: "Last 3 months" },
  { key: "ytd", label: "This year" },
  { key: "12m", label: "Last 12 months" },
];

export function periodMonths(key: PeriodKey, now = new Date()): { months: MonthKey[]; label: string; inWords: string } {
  const cur = monthOf(now);
  switch (key) {
    case "last": {
      const m = addMonths(cur, -1);
      return { months: [m], label: monthLabel(m, true), inWords: `in ${monthLabel(m, true)}` };
    }
    case "3m":
      return { months: monthRange(addMonths(cur, -2), cur), label: "Last 3 months", inWords: "in the last 3 months" };
    case "ytd":
      return { months: monthRange(`${cur.slice(0, 4)}-01`, cur), label: `${cur.slice(0, 4)} so far`, inWords: `in ${cur.slice(0, 4)} so far` };
    case "12m":
      return { months: monthRange(addMonths(cur, -11), cur), label: "Last 12 months", inWords: "in the last 12 months" };
    default:
      return { months: [cur], label: `${monthLabel(cur, true)} so far`, inWords: `in ${monthLabel(cur, true)} so far` };
  }
}

/** Naira per dollar: the operator's own figure when set, else today's market rate. */
export async function dollarRate(): Promise<{ ngnPerUsd: number; market: number | null; own: boolean }> {
  const [raw, rates] = await Promise.all([getSetting(NGN_PER_USD_KEY, ""), getRates()]);
  const perNgn = rateFor(rates, "USD");
  const market = perNgn ? 1 / perNgn : null;
  const own = Number(raw);
  if (raw.trim() && Number.isFinite(own) && own > 0) return { ngnPerUsd: own, market, own: true };
  // 1,500 only when no rate service has ever answered and nobody has typed one.
  return { ngnPerUsd: market ?? 1500, market, own: false };
}

/** The month a timestamp column falls in, in Lagos. */
const lagosMonth = (col: unknown) => sql<string>`to_char(${col} at time zone 'Africa/Lagos', 'YYYY-MM')`;

export type CostPageData = {
  report: CostReport;
  /** The last twelve months, whatever the period on screen, for the chart. */
  series: CostReport["series"];
  ctx: InsightContext;
  items: CostItemView[];
  income: IncomeView[];
  churchOptions: { id: string; name: string }[];
  rate: { ngnPerUsd: number; market: number | null; own: boolean };
};

export type CostItemView = {
  id: string;
  name: string;
  vendor: string | null;
  category: string;
  amount: number;
  currency: string;
  amountNgn: number;
  frequency: Frequency;
  startsOn: string;
  endsOn: string | null;
  spreadMonths: number | null;
  purpose: string | null;
  driver: CostDriver;
  channel: string | null;
  /** Cost over the period on screen. */
  inPeriod: number;
  /** Of that, the part no church used. */
  untraced: number;
};

export type IncomeView = {
  id: string;
  receivedOn: string;
  category: string;
  amount: number;
  currency: string;
  amountNgn: number;
  source: string | null;
  churchId: string | null;
  churchName: string | null;
  reference: string | null;
  description: string | null;
};

/** Everything since this month, for the readings and the per-month figures. */
function startOf(m: MonthKey): Date {
  // Midnight on the 1st in Lagos is 23:00 the day before in UTC.
  return new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1) - 60 * 60 * 1000);
}

export async function loadCostInputs(months: MonthKey[], now = new Date()) {
  const first = months[0];
  const since = startOf(first);
  const sinceDay = `${first}-01`;
  const current = monthOf(now);

  const [
    rate,
    smsPrice,
    float,
    customs,
    churchRows,
    memberRows,
    storageRows,
    partnerRows,
    leadRows,
    itemRows,
    incomeRows,
    paymentRows,
    walletTopups,
    smsTopups,
    walletRows,
    creditRows,
    commissionRows,
    usageRows,
    meetingRows,
    activeRows,
    aiRows,
    readings,
    pendingRows,
  ] = await Promise.all([
    dollarRate(),
    getSmsPrice(),
    getFloatOverview(),
    listCustomPlans({ includeArchived: true }),
    db
      .select({
        id: church.id,
        name: church.name,
        plan: church.plan,
        customPlanId: church.customPlanId,
        createdAt: church.createdAt,
        trialEndsAt: church.trialEndsAt,
        referredByChurchId: church.referredByChurchId,
      })
      .from(church)
      .where(eq(church.isDemo, false)),
    db.select({ churchId: member.churchId, n: sql<number>`count(*)::int` }).from(member).groupBy(member.churchId),
    db.select({ churchId: media.churchId, bytes: sql<string>`coalesce(sum(${media.bytes}), 0)` }).from(media).groupBy(media.churchId),
    db.select({ churchId: partnerReferral.churchId }).from(partnerReferral),
    db
      .select({ churchId: lead.convertedChurchId, source: lead.source, convertedAt: lead.convertedAt })
      .from(lead)
      .where(isNotNull(lead.convertedChurchId)),
    db.select().from(platformCostItem).where(isNull(platformCostItem.archivedAt)),
    db
      .select({
        id: platformIncomeEntry.id,
        receivedOn: platformIncomeEntry.receivedOn,
        category: platformIncomeEntry.category,
        amount: platformIncomeEntry.amount,
        currency: platformIncomeEntry.currency,
        amountNgn: platformIncomeEntry.amountNgn,
        source: platformIncomeEntry.source,
        churchId: platformIncomeEntry.churchId,
        churchName: church.name,
        reference: platformIncomeEntry.reference,
        description: platformIncomeEntry.description,
      })
      .from(platformIncomeEntry)
      .leftJoin(church, eq(church.id, platformIncomeEntry.churchId))
      .where(isNull(platformIncomeEntry.voidedAt)),
    // Every plan payment ever: a year paid last March still has months here.
    db
      .select({
        churchId: payment.churchId,
        paidAt: sql<Date>`coalesce(${payment.paidAt}, ${payment.createdAt})`,
        amount: payment.amount,
        periodMonths: payment.periodMonths,
        gateway: payment.gateway,
        fee: payment.gatewayFee,
        surcharge: payment.surchargeAmount,
      })
      .from(payment)
      .where(and(eq(payment.status, "success"), notVoided)),
    db
      .select({ churchId: walletTopup.churchId, paidAt: walletTopup.paidAt, amount: walletTopup.amount, fee: walletTopup.gatewayFee })
      .from(walletTopup)
      .where(and(eq(walletTopup.status, "success"), gte(walletTopup.paidAt, since))),
    db
      .select({ churchId: smsTopup.churchId, paidAt: smsTopup.paidAt, amount: smsTopup.amount })
      .from(smsTopup)
      .where(and(eq(smsTopup.status, "success"), gte(smsTopup.paidAt, since))),
    // What churches spent from their wallets: debits for SMS and storage, less refunds.
    db
      .select({
        churchId: walletTxn.churchId,
        month: lagosMonth(walletTxn.createdAt),
        category: walletTxn.category,
        kind: walletTxn.kind,
        amount: sql<string>`sum(${walletTxn.amount})`,
      })
      .from(walletTxn)
      .where(and(gte(walletTxn.createdAt, since), sql`${walletTxn.category} in ('sms','storage','refund')`))
      .groupBy(walletTxn.churchId, lagosMonth(walletTxn.createdAt), walletTxn.category, walletTxn.kind),
    // Credit we handed out: referral and welcome rewards, and anything added by hand.
    db
      .select({
        churchId: walletTxn.churchId,
        month: lagosMonth(walletTxn.createdAt),
        kind: walletTxn.kind,
        referral: sql<boolean>`(${walletTxn.reason} like 'Referral reward%' or ${walletTxn.reason} like 'Welcome credit%')`,
        amount: sql<string>`sum(${walletTxn.amount})`,
      })
      .from(walletTxn)
      .where(and(gte(walletTxn.createdAt, since), eq(walletTxn.category, "adjustment")))
      .groupBy(
        walletTxn.churchId,
        lagosMonth(walletTxn.createdAt),
        walletTxn.kind,
        sql`(${walletTxn.reason} like 'Referral reward%' or ${walletTxn.reason} like 'Welcome credit%')`,
      ),
    db
      .select({ churchId: partnerEarning.churchId, month: lagosMonth(partnerEarning.createdAt), amount: sql<string>`sum(${partnerEarning.amount})` })
      .from(partnerEarning)
      .where(and(gte(partnerEarning.createdAt, since), ne(partnerEarning.status, "cancelled")))
      .groupBy(partnerEarning.churchId, lagosMonth(partnerEarning.createdAt)),
    db
      .select({
        churchId: usageStat.churchId,
        month: sql<string>`to_char(${usageStat.day}, 'YYYY-MM')`,
        metric: usageStat.metric,
        n: sql<number>`sum(${usageStat.count})::int`,
      })
      .from(usageStat)
      .where(and(gte(usageStat.day, sinceDay), sql`${usageStat.metric} in ('sms_pages','email')`))
      .groupBy(usageStat.churchId, sql`to_char(${usageStat.day}, 'YYYY-MM')`, usageStat.metric),
    db
      .select({
        churchId: meeting.churchId,
        month: lagosMonth(meetingParticipant.joinedAt),
        bytes: sql<string>`coalesce(sum(${meetingParticipant.bytesReceived}), 0)`,
      })
      .from(meetingParticipant)
      .innerJoin(meeting, eq(meeting.id, meetingParticipant.meetingId))
      .where(and(gte(meetingParticipant.joinedAt, since), eq(meeting.transport, "sfu")))
      .groupBy(meeting.churchId, lagosMonth(meetingParticipant.joinedAt)),
    // A church was active in a month when any of its own team did anything in it.
    db
      .selectDistinct({ churchId: staff.organizationId, month: sql<string>`to_char(${userActiveDay.day}, 'YYYY-MM')` })
      .from(userActiveDay)
      .innerJoin(staff, and(eq(staff.userId, userActiveDay.userId), eq(staff.temp, false)))
      .where(gte(userActiveDay.day, sinceDay)),
    // AI in nano-dollars. An abandoned call is charged at its reservation, as the budget does.
    db
      .select({
        churchId: aiCall.churchId,
        month: aiCall.budgetMonth,
        nano: sql<string>`coalesce(sum(coalesce(${aiCall.costNano}, case when ${aiCall.status} = 'abandoned' then ${aiCall.reservedNano} else 0 end)), 0)`,
      })
      .from(aiCall)
      .where(gte(aiCall.budgetMonth, first))
      .groupBy(aiCall.churchId, aiCall.budgetMonth),
    db
      .select({ at: termiiSnapshot.fetchedAt, balance: termiiSnapshot.balance })
      .from(termiiSnapshot)
      .where(and(eq(termiiSnapshot.ok, true), isNotNull(termiiSnapshot.balance), gte(termiiSnapshot.fetchedAt, new Date(since.getTime() - 3 * 86_400_000)))),
    db.select({ amount: sql<string>`coalesce(sum(${payment.amount}), 0)` }).from(payment).where(and(eq(payment.status, "pending"), notVoided)),
  ]);

  const ids = new Set(churchRows.map((c) => c.id));
  const customName = new Map(customs.map((p) => [p.id, p.name]));
  const members = new Map(memberRows.map((r) => [r.churchId, Number(r.n)]));
  const storage = new Map(storageRows.map((r) => [r.churchId, Number(r.bytes)]));
  const viaPartner = new Set(partnerRows.map((r) => r.churchId));
  const leadSource = new Map<string, string>();
  for (const l of leadRows) if (l.churchId && l.source) leadSource.set(l.churchId, l.source.trim().toLowerCase());

  // Paying in the last month on screen: needed for "on trial" (a trial church that paid is paying).
  const lastMonth = months[months.length - 1];

  const churches: ChurchInput[] = churchRows.map((c) => ({
    id: c.id,
    name: c.name,
    planKey: c.customPlanId ? `custom:${c.customPlanId}` : c.plan,
    planLabel: c.customPlanId ? (customName.get(c.customPlanId) ?? "Custom plan") : planName(c.plan),
    joined: monthOf(c.createdAt),
    onTrial: c.trialEndsAt != null && c.trialEndsAt.getTime() > now.getTime(),
    channel: viaPartner.has(c.id) ? "partner" : c.referredByChurchId ? "referral" : (leadSource.get(c.id) ?? "direct"),
    members: members.get(c.id) ?? 0,
    storageBytes: storage.get(c.id) ?? 0,
  }));

  const toNgn = (amount: number, currency: string) => (currency.toUpperCase() === "USD" ? amount * rate.ngnPerUsd : amount);

  const items: CostInputs["items"] = itemRows.map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category,
    amountNgn: toNgn(Number(i.amount), i.currency),
    foreign: i.currency.toUpperCase() !== "NGN",
    frequency: i.frequency as Frequency,
    startsOn: i.startsOn,
    endsOn: i.endsOn,
    spreadMonths: i.spreadMonths,
    driver: i.driver as CostDriver,
    channel: i.channel,
  }));

  // Wallet spend: debits are spend; an SMS refund (a credit) gives some back.
  const walletSpend: CostInputs["walletSpend"] = [];
  for (const w of walletRows) {
    if (!ids.has(w.churchId)) continue;
    const n = Number(w.amount) || 0;
    if (w.category === "refund") {
      if (w.kind === "credit") walletSpend.push({ churchId: w.churchId, month: w.month, category: "sms", amount: -n });
      continue;
    }
    if (w.kind !== "debit") continue;
    walletSpend.push({ churchId: w.churchId, month: w.month, category: w.category === "storage" ? "storage" : "sms", amount: n });
  }

  const creditsGiven: CostInputs["creditsGiven"] = [];
  for (const r of creditRows) {
    if (!ids.has(r.churchId)) continue;
    const n = Number(r.amount) || 0;
    if (r.referral) {
      if (r.kind === "credit") creditsGiven.push({ churchId: r.churchId, month: r.month, kind: "referral", amount: n });
    } else creditsGiven.push({ churchId: r.churchId, month: r.month, kind: "by_hand", amount: r.kind === "credit" ? n : -n });
  }

  // Usage, one row per church per month.
  const usage = new Map<string, CostInputs["usage"][number]>();
  const row = (churchId: string, month: string) => {
    const k = `${churchId}|${month}`;
    let u = usage.get(k);
    if (!u) {
      u = { churchId, month, smsPages: 0, emails: 0, meetingGb: 0, active: false };
      usage.set(k, u);
    }
    return u;
  };
  for (const u of usageRows) {
    if (!ids.has(u.churchId)) continue;
    if (u.metric === "sms_pages") row(u.churchId, u.month).smsPages += Number(u.n);
    else row(u.churchId, u.month).emails += Number(u.n);
  }
  for (const m of meetingRows) if (ids.has(m.churchId)) row(m.churchId, m.month).meetingGb += Number(m.bytes) / 1024 ** 3;
  for (const a of activeRows) if (ids.has(a.churchId)) row(a.churchId, a.month).active = true;

  const input: CostInputs = {
    months,
    currentMonth: months.includes(current) ? current : null,
    churches,
    items,
    payments: paymentRows
      .filter((p) => p.churchId == null || ids.has(p.churchId))
      .map((p) => ({
        churchId: p.churchId,
        paidAt: new Date(p.paidAt),
        amount: Number(p.amount),
        periodMonths: p.periodMonths,
        gateway: p.gateway,
        fee: p.fee == null ? null : Number(p.fee),
        international: Number(p.surcharge) > 0,
      })),
    topups: [
      ...walletTopups.filter((t) => t.paidAt && ids.has(t.churchId)).map((t) => ({ churchId: t.churchId, paidAt: t.paidAt!, amount: Number(t.amount), fee: t.fee == null ? null : Number(t.fee) })),
      ...smsTopups.filter((t) => t.paidAt && ids.has(t.churchId)).map((t) => ({ churchId: t.churchId, paidAt: t.paidAt!, amount: Number(t.amount), fee: null })),
    ],
    walletSpend,
    creditsGiven,
    partnerCommission: commissionRows.map((r) => ({ churchId: r.churchId, month: r.month, amount: Number(r.amount) || 0 })),
    income: incomeRows.map((e) => ({ churchId: e.churchId, month: e.receivedOn.slice(0, 7), category: e.category, amountNgn: Number(e.amountNgn) })),
    usage: [...usage.values()],
    ai: aiRows.map((r) => ({ churchId: r.churchId, month: r.month, amount: (Number(r.nano) / 1e9) * rate.ngnPerUsd })),
    smsUnitCost: float.unitCost,
    smsPrice,
    termiiMeasured: termiiSpendByMonth(
      readings.map((r) => ({ at: r.at, balance: Number(r.balance) })),
      now,
    ).map((t) => ({ month: t.month, spent: t.spent })),
    ngnPerUsd: rate.ngnPerUsd,
  };

  return {
    input,
    rate,
    // "auto" falls back to the typed figure when the balance history is too thin, so ask what was used.
    unitCost: (float.unitCost == null ? "missing" : float.unitCostIsEstimated ? "derived" : "manual") as InsightContext["unitCost"],
    pendingAmount: Number(pendingRows[0]?.amount ?? 0),
    itemRows,
    incomeRows,
    churchRows,
    lastMonth,
  };
}

export async function loadCostPage(months: MonthKey[], periodInWords: string, now = new Date()): Promise<CostPageData> {
  // One read covers the period on screen and the twelve months the chart shows.
  const cur = monthOf(now);
  const twelve = monthRange(addMonths(cur, -11), cur);
  const loaded = await loadCostInputs(months[0] < twelve[0] ? monthRange(months[0], cur) : twelve, now);
  const report = buildCostReport({ ...loaded.input, months, currentMonth: months.includes(cur) ? cur : null });
  const series = buildCostReport({ ...loaded.input, months: twelve, currentMonth: cur }).series;
  const lineByItem = new Map(report.lines.filter((l) => l.itemId).map((l) => [l.itemId!, l]));

  const items: CostItemView[] = loaded.itemRows
    .map((i) => {
      const line = lineByItem.get(i.id);
      return {
        id: i.id,
        name: i.name,
        vendor: i.vendor,
        category: i.category,
        amount: Number(i.amount),
        currency: i.currency,
        amountNgn: i.currency.toUpperCase() === "USD" ? Number(i.amount) * loaded.rate.ngnPerUsd : Number(i.amount),
        frequency: i.frequency as Frequency,
        startsOn: i.startsOn,
        endsOn: i.endsOn,
        spreadMonths: i.spreadMonths,
        purpose: i.purpose,
        driver: i.driver as CostDriver,
        channel: i.channel,
        inPeriod: line?.amount ?? 0,
        untraced: line?.untraced ?? 0,
      };
    })
    .sort((a, b) => b.inPeriod - a.inPeriod || a.name.localeCompare(b.name));

  const live = items.filter((i) => i.inPeriod > 0);
  const ctx: InsightContext = {
    // A price change is a second line with the same name: still one bill.
    itemsActive: new Set(live.map((i) => i.name.trim().toLowerCase())).size,
    categories: [...new Set(live.map((i) => i.category))],
    unitCost: loaded.unitCost,
    termiiConfigured: isTermiiConfigured(),
    ngnPerUsd: loaded.rate.ngnPerUsd,
    marketNgnPerUsd: loaded.rate.market,
    rateIsOwn: loaded.rate.own,
    foreignCost: live.filter((i) => i.currency.toUpperCase() !== "NGN").reduce((n, i) => n + i.inPeriod, 0),
    pendingAmount: loaded.pendingAmount,
    payingWithoutSource: report.churches.filter((c) => c.status === "paying" && c.channel === "direct").length,
    storageDriverUsed: live.some((i) => i.driver === "storage"),
    unusedItems: live
      .filter((i) => i.untraced > 0 && i.untraced / i.inPeriod > 0.5 && categoryDef(i.category).driver !== "none")
      .map((i) => ({ name: i.name, amount: i.untraced })),
    periodLabel: periodInWords,
  };

  const inRange = new Set(months);
  const income: IncomeView[] = loaded.incomeRows
    .filter((e) => inRange.has(e.receivedOn.slice(0, 7)))
    .map((e) => ({
      id: e.id,
      receivedOn: e.receivedOn,
      category: e.category,
      amount: Number(e.amount),
      currency: e.currency,
      amountNgn: Number(e.amountNgn),
      source: e.source,
      churchId: e.churchId,
      churchName: e.churchName,
      reference: e.reference,
      description: e.description,
    }))
    .sort((a, b) => (a.receivedOn < b.receivedOn ? 1 : -1));

  return {
    report,
    series,
    ctx,
    items,
    income,
    churchOptions: loaded.churchRows.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    rate: loaded.rate,
  };
}
