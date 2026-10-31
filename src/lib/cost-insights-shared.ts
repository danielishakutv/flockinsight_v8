/**
 * What to do about the numbers, and how far to trust them.
 *
 * Both lists are rules over a CostReport, written out here rather than asked
 * of a model, so they are free, instant, always on, and tested
 * (cost-insights-shared.test.ts). The AI briefing on the same page is a
 * second opinion in prose over the same figures, never the only source.
 *
 * `accuracyChecks` is the answer to "how do I know this is right": every way
 * the report can be wrong that the platform can detect, each with its fix.
 * A report is only as accurate as its weakest input, so the page shows the
 * checks beside the figures, not on a settings screen nobody opens.
 */

import { formatMoneyPlain } from "@/lib/money";
import { BUCKET_LABEL, SERVE_BUCKETS, type CostReport } from "@/lib/cost-to-serve-shared";

export type Tone = "bad" | "warn" | "good" | "info";

export type Insight = {
  key: string;
  tone: Tone;
  title: string;
  body: string;
  /** A tab on the page (#churches) or another admin page. */
  href?: string;
  action?: string;
};

export type CheckStatus = "ok" | "warn" | "missing";

export type Check = {
  key: string;
  status: CheckStatus;
  title: string;
  detail: string;
  fix?: { label: string; href?: string; action?: "fetch-fees" | "set-rate" };
};

export type InsightContext = {
  /** Entered costs live in the period. */
  itemsActive: number;
  /** Categories with at least one live entered cost. */
  categories: string[];
  /** Termii cost per page: typed in, worked out from the balance, or not known. */
  unitCost: "manual" | "derived" | "missing";
  termiiConfigured: boolean;
  /** Naira per dollar in use, and whether it is the operator's own figure. */
  ngnPerUsd: number;
  marketNgnPerUsd: number | null;
  rateIsOwn: boolean;
  /** Entered costs priced in dollars, in naira, over the period. */
  foreignCost: number;
  /** Plan payments still pending: money the gateway never confirmed, in no figure. */
  pendingAmount: number;
  /** Paying churches whose source is unknown. */
  payingWithoutSource: number;
  /** An entered cost is shared by storage, which uses today's sizes for every month. */
  storageDriverUsed: boolean;
  /** Names of entered costs that no church used in the period, with what they cost. */
  unusedItems: { name: string; amount: number }[];
  periodLabel: string;
};

const money = (n: number) => formatMoneyPlain(Math.round(n));
const pctText = (n: number) => `${Math.round(n)}%`;

export function recommendations(r: CostReport, ctx: InsightContext): Insight[] {
  const out: Insight[] = [];
  const period = ctx.periodLabel;

  if (r.revenue.total === 0 && r.totalCost === 0) {
    out.push({
      key: "empty",
      tone: "info",
      title: "Nothing to work out yet",
      body: "No revenue and no costs in this period. Add what you pay for under Costs, and the figures fill in from what churches pay and use.",
      href: "#costs",
      action: "Add a cost",
    });
    return out;
  }

  // 1. The headline.
  const be = r.breakEven;
  const beText =
    be.payingNeeded != null && be.contributionPerPaying != null
      ? ` Each paying church leaves about ${money(be.contributionPerPaying)} a month after its own SMS, AI and fees, so your bills need ${be.payingNeeded} paying ${be.payingNeeded === 1 ? "church" : "churches"}; you have ${be.payingNow}.`
      : "";
  if (r.profit < 0) {
    out.push({
      key: "loss",
      tone: "bad",
      title: `You lost ${money(-r.profit)} ${period}`,
      body: `Revenue ${money(r.revenue.total)} against costs of ${money(r.totalCost)}.${beText}`,
    });
  } else {
    out.push({
      key: "profit",
      tone: "good",
      title: `You made ${money(r.profit)} profit ${period}`,
      body: `Revenue ${money(r.revenue.total)}, costs ${money(r.totalCost)}${r.marginPct != null ? `: a ${pctText(r.marginPct)} margin` : ""}.${beText}`,
    });
  }

  // 2. Gross margin: what serving churches eats.
  if (r.grossMarginPct != null && r.grossMarginPct < 60 && r.serve > 0) {
    const biggest = SERVE_BUCKETS.map((b) => ({ b, n: r.byBucket[b] })).sort((x, y) => y.n - x.n)[0];
    out.push({
      key: "gross",
      tone: r.grossMarginPct < 30 ? "bad" : "warn",
      title: `Serving churches takes ${pctText(100 - r.grossMarginPct)} of revenue`,
      body: `Software like this usually keeps 70% or more after the cost of serving. The largest part of yours is ${BUCKET_LABEL[biggest.b].toLowerCase()} at ${money(biggest.n)}.`,
      href: "#features",
      action: "See costs by feature",
    });
  }

  // 3. Paying churches that cost more than they pay.
  const losing = r.churches.filter((c) => c.status === "paying" && c.margin < 0);
  if (losing.length > 0) {
    const top = losing.slice(0, 3).map((c) => `${c.name} (${money(-c.margin)})`).join(", ");
    out.push({
      key: "losing-paying",
      tone: "warn",
      title: `${losing.length} paying ${losing.length === 1 ? "church costs" : "churches cost"} more than ${losing.length === 1 ? "it pays" : "they pay"}`,
      body: `Most behind: ${top}. Look at what drives it in their row (usually SMS or storage) before the price.`,
      href: "#churches",
      action: "See every church",
    });
  }

  // 4. Plans that lose money.
  for (const p of r.plans) {
    if (p.churches === 0 || p.margin >= 0 || p.revenue === 0) continue;
    out.push({
      key: `plan:${p.key}`,
      tone: "warn",
      title: `${p.label} loses money`,
      body: `Each church on it pays about ${money(p.revenuePerChurchMonth)} a month and costs ${money(p.costPerChurchMonth)} to serve.`,
      href: "#plans",
      action: "See plans",
    });
  }

  // 5. Churches not paying.
  const notPaying = r.statuses.filter((s) => s.key !== "paying");
  const notPayingCost = notPaying.reduce((n, s) => n + s.cost, 0);
  if (notPayingCost > 0) {
    const share = r.serve > 0 ? (notPayingCost / r.serve) * 100 : 0;
    const parts = notPaying.filter((s) => s.cost > 0).map((s) => `${s.label.toLowerCase()} ${money(s.cost)} (${s.churches})`);
    out.push({
      key: "not-paying",
      tone: share > 40 ? "warn" : "info",
      title: `Churches that are not paying cost ${money(notPayingCost)} to serve`,
      body: `${parts.join("; ")}. That is ${pctText(share)} of your serving cost. Trials are an investment; a lapsed church still using SMS or storage is not.`,
      href: "#churches",
    });
  }

  // 6. SMS.
  if (r.sms.unitCost == null && r.sms.pages > 0) {
    out.push({
      key: "sms-cost",
      tone: "warn",
      title: "SMS has no cost per page yet",
      body: `${r.sms.pages.toLocaleString()} pages were sent and none of them is counted as a cost. Set what Termii charges per page in SMS settings.`,
      href: "/superadmin/sms",
      action: "SMS settings",
    });
  } else if (r.sms.markupPct != null && r.sms.markupPct < 25) {
    out.push({
      key: "sms-markup",
      tone: r.sms.markupPct < 0 ? "bad" : "warn",
      title: r.sms.markupPct < 0 ? "Every SMS page loses money" : `SMS earns only ${r.sms.markupPct}% over cost`,
      body: `Churches pay ₦${r.sms.price} a page and Termii charges ₦${r.sms.unitCost}. Failed sends, refunds and codes come out of that margin too.`,
      href: "/superadmin/sms",
      action: "SMS price",
    });
  }
  if (r.sms.measured != null && r.sms.measured > 0 && r.sms.gap != null && Math.abs(r.sms.gap) / r.sms.measured > 0.1) {
    out.push({
      key: "sms-gap",
      tone: "warn",
      title: r.sms.gap > 0 ? `Termii charged ${money(r.sms.gap)} that no church sent` : `Termii charged ${money(-r.sms.gap)} less than churches' sends`,
      body:
        r.sms.gap > 0
          ? "Sign-in codes and platform messages are not any church's, or the cost per page is set too low. The gap is counted as a cost of running SMS."
          : "The cost per page is probably set too high, or the balance was not read for part of the period.",
      href: "#accuracy",
    });
  }

  // 7. One bill dominating. A bill whose price changed is several lines with one name: add them up.
  const entered = r.lines.filter((l) => l.basis === "entered");
  const byName = new Map<string, { label: string; amount: number }>();
  for (const l of entered) {
    const k = l.label.trim().toLowerCase();
    const b = byName.get(k) ?? { label: l.label, amount: 0 };
    b.amount += l.amount;
    byName.set(k, b);
  }
  const bills = [...byName.values()].sort((x, y) => y.amount - x.amount);
  const top = bills[0];
  if (top && r.totalCost > 0 && top.amount / r.totalCost > 0.4 && r.lines.length > 1) {
    out.push({
      key: "dominant",
      tone: "info",
      title: `${top.label} is ${pctText((top.amount / r.totalCost) * 100)} of everything you spend`,
      body: "The single bill to check first when prices are reviewed: a smaller plan, a yearly discount, or a cheaper vendor.",
      href: "#costs",
    });
  }

  // 8. Paying for something nobody used.
  for (const u of ctx.unusedItems.slice(0, 3)) {
    out.push({
      key: `unused:${u.name}`,
      tone: "info",
      title: `No church used what ${u.name} pays for`,
      body: `It cost ${money(u.amount)} ${period} and nothing it is shared by happened. It is still counted, as cost no church accounts for.`,
      href: "#costs",
    });
  }

  // 9. Dollar exposure.
  const enteredTotal = entered.reduce((n, l) => n + l.amount, 0);
  if (ctx.foreignCost > 0 && enteredTotal > 0 && ctx.foreignCost / enteredTotal > 0.3) {
    out.push({
      key: "fx",
      tone: "info",
      title: `${pctText((ctx.foreignCost / enteredTotal) * 100)} of your bills are in dollars`,
      body: "A weaker naira raises them without any change in use. Paying yearly locks the price; a naira vendor removes the risk.",
    });
  }

  // 10. Winning churches.
  const a = r.acquisitionStats;
  if (a.spend > 0 && a.newPaying === 0) {
    out.push({
      key: "cac-none",
      tone: "warn",
      title: `${money(a.spend)} spent on winning churches, and no new paying church`,
      body: "Either the spend has not converted yet, or it is going to the wrong channel. Tag each marketing cost with its channel to see which.",
      href: "#acquisition",
    });
  } else if (a.cac != null) {
    if (a.paybackMonths != null && a.paybackMonths > 12) {
      out.push({
        key: "payback",
        tone: "warn",
        title: `A new paying church takes ${Math.round(a.paybackMonths)} months to pay back what it cost to win`,
        body: `${money(a.cac)} to win one, and each leaves about ${money(a.grossPerPayingMonth ?? 0)} a month. Under 12 months is healthy.`,
        href: "#acquisition",
      });
    }
    if (a.ltvToCac != null && a.ltvToCac < 3) {
      out.push({
        key: "ltv",
        tone: a.ltvToCac < 1 ? "bad" : "warn",
        title: `A church is worth ${a.ltvToCac.toFixed(1)}× what it costs to win`,
        body: "Three times or more is the usual bar. Below one, every new church loses money over its lifetime.",
        href: "#acquisition",
      });
    }
    const priced = a.byChannel.filter((c) => c.cac != null && c.spend > 0);
    if (priced.length >= 2) {
      const best = [...priced].sort((x, y) => x.cac! - y.cac!)[0];
      const worst = [...priced].sort((x, y) => y.cac! - x.cac!)[0];
      if (best.channel !== worst.channel)
        out.push({
          key: "channel",
          tone: "good",
          title: `${cap(best.channel)} brings paying churches cheapest`,
          body: `${money(best.cac!)} each, against ${money(worst.cac!)} through ${worst.channel}. Move spend towards what works.`,
          href: "#acquisition",
        });
    }
  } else if (a.newPaying > 0 && a.spend === 0) {
    out.push({
      key: "cac-free",
      tone: "info",
      title: `${a.newPaying} new paying ${a.newPaying === 1 ? "church" : "churches"}, and no marketing recorded`,
      body: "If you spent on ads, events or flyers, add them as Marketing costs so the cost of winning a church can be worked out.",
      href: "#costs",
    });
  }
  if (a.monthlyChurn != null && a.monthlyChurn > 0.08) {
    out.push({
      key: "churn",
      tone: "warn",
      title: `${pctText(a.monthlyChurn * 100)} of paying churches stop paying each month`,
      body: "At that rate the average church stays about " + Math.round(1 / a.monthlyChurn) + " months. Call churches before their renewal date, not after.",
      href: "/superadmin/finance",
    });
  }

  // 11. Cost that reaches no church.
  if (r.serve > 0 && r.untraced / r.serve > 0.15) {
    out.push({
      key: "untraced",
      tone: "info",
      title: `${money(r.untraced)} of serving cost reaches no church`,
      body: "Platform AI, SMS no church sent, and bills in months nobody used them. They are in the totals, but not in any church's row.",
      href: "#accuracy",
    });
  }

  return out;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CORE_CATEGORIES: { key: string; label: string }[] = [
  { key: "hosting", label: "Hosting & servers" },
  { key: "domain", label: "Domains & DNS" },
  { key: "email", label: "Email sending" },
];

export function accuracyChecks(r: CostReport, ctx: InsightContext): Check[] {
  const out: Check[] = [];

  out.push(
    ctx.itemsActive > 0
      ? { key: "items", status: "ok", title: `${ctx.itemsActive} bills entered`, detail: "Everything the platform cannot measure for itself." }
      : {
          key: "items",
          status: "missing",
          title: "No bills entered",
          detail: "Cost to serve is only the measured part (SMS, AI, fees) until you add what you pay for.",
          fix: { label: "Add a cost", href: "#costs" },
        },
  );
  for (const c of CORE_CATEGORIES) {
    if (ctx.categories.includes(c.key)) continue;
    out.push({
      key: `cat:${c.key}`,
      status: "missing",
      title: `${c.label}: nothing entered`,
      detail: "Every platform pays for this. Without it, cost to serve reads lower than it is.",
      fix: { label: "Add it", href: "#costs" },
    });
  }

  out.push(
    ctx.unitCost === "manual"
      ? { key: "unit", status: "ok", title: `Termii cost per page: ₦${r.sms.unitCost}`, detail: "Typed in. Check it against Termii's invoice whenever their price changes." }
      : ctx.unitCost === "derived"
        ? {
            key: "unit",
            status: "warn",
            title: `Termii cost per page: ₦${r.sms.unitCost}, worked out from the balance`,
            detail: "An estimate from balance readings. Type in the figure on Termii's invoice for an exact one.",
            fix: { label: "SMS settings", href: "/superadmin/sms" },
          }
        : {
            key: "unit",
            status: "missing",
            title: "Termii cost per page is not set",
            detail: "Without it, no SMS sent counts as a cost.",
            fix: { label: "SMS settings", href: "/superadmin/sms" },
          },
  );

  if (!ctx.termiiConfigured) {
    out.push({ key: "termii", status: "warn", title: "Termii balance is not read", detail: "SMS cost is pages times the cost per page, with nothing to check it against." });
  } else if (r.sms.measuredMonths === 0) {
    out.push({
      key: "termii",
      status: "warn",
      title: "No Termii balance readings for this period",
      detail: "The balance check could not be made. Readings are taken every 30 minutes from the first one.",
    });
  } else if (r.sms.measured != null && r.sms.gap != null) {
    const gapPct = r.sms.measured > 0 ? Math.abs(r.sms.gap) / r.sms.measured : 0;
    out.push({
      key: "termii",
      status: gapPct <= 0.1 ? "ok" : "warn",
      title:
        gapPct <= 0.1
          ? `Termii's balance agrees with what churches sent (within ${pctText(gapPct * 100)})`
          : `Termii's balance and churches' sends differ by ${money(Math.abs(r.sms.gap))} (${pctText(gapPct * 100)})`,
      detail:
        `Termii's balance fell by ${money(r.sms.measured)} over ${r.sms.measuredMonths} month${r.sms.measuredMonths === 1 ? "" : "s"}, top-ups taken out. The difference is sign-in codes, platform messages, or a cost per page that is off.` +
        (ctx.unitCost === "derived" ? " The cost per page was itself worked out from this balance, so the two agreeing proves little: type in Termii's figure." : ""),
    });
  }

  out.push(
    r.fees.estimatedCount === 0
      ? { key: "fees", status: "ok", title: "Paystack fees are Paystack's own figures", detail: "Read from each payment when it was verified." }
      : {
          key: "fees",
          status: "warn",
          title: `${r.fees.estimatedCount} payment fee${r.fees.estimatedCount === 1 ? " is" : "s are"} estimated`,
          detail: `${money(r.fees.estimated)} at Paystack's published rate, for payments from before the actual fee was kept. Paystack can still tell us the real figure.`,
          fix: { label: "Fetch actual fees from Paystack", action: "fetch-fees" },
        },
  );

  if (ctx.foreignCost > 0 || ctx.rateIsOwn) {
    out.push(
      ctx.rateIsOwn
        ? {
            key: "rate",
            status: "ok",
            title: `Dollar bills at your rate: ₦${Math.round(ctx.ngnPerUsd).toLocaleString()} per $`,
            detail: ctx.marketNgnPerUsd ? `The market rate today is ₦${Math.round(ctx.marketNgnPerUsd).toLocaleString()}.` : "What your bank actually charges.",
            fix: { label: "Change it", action: "set-rate" },
          }
        : {
            key: "rate",
            status: "warn",
            title: `Dollar bills at the market rate: ₦${Math.round(ctx.ngnPerUsd).toLocaleString()} per $`,
            detail: "A naira card charged in dollars usually costs more than the market rate. Enter what your bank statement shows.",
            fix: { label: "Enter your rate", action: "set-rate" },
          },
    );
  }

  if (ctx.pendingAmount > 0) {
    out.push({
      key: "pending",
      status: "warn",
      title: `${money(ctx.pendingAmount)} of plan payments still pending`,
      detail: "Money the gateway never confirmed is in no figure here. Settle or void it on Finance.",
      fix: { label: "Finance", href: "/superadmin/finance" },
    });
  }

  const byHand = r.lines.find((l) => l.key === "over:credit");
  if (byHand) {
    out.push({
      key: "credit",
      status: "warn",
      title: `${money(byHand.amount)} of wallet credit added by hand counts as given away`,
      detail: "If a church paid you for that credit in cash or by transfer, record it under Income as a church paying for wallet credit, and it stops being counted as a gift.",
      fix: { label: "Record income", href: "#income" },
    });
  }

  if (r.acquisitionStats.untaggedSpend > 0) {
    out.push({
      key: "channels",
      status: "warn",
      title: `${money(r.acquisitionStats.untaggedSpend)} of marketing has no channel`,
      detail: "It counts in the overall cost of winning a church, but not in any channel's.",
      fix: { label: "Edit marketing costs", href: "#costs" },
    });
  }
  if (ctx.payingWithoutSource > 0) {
    out.push({
      key: "sources",
      status: "warn",
      title: `${ctx.payingWithoutSource} paying ${ctx.payingWithoutSource === 1 ? "church has" : "churches have"} no known source`,
      detail: "A church's channel comes from a Partner, a referral, or its lead in Growth marked as converted. Convert the lead and the church counts towards that channel.",
      fix: { label: "Growth", href: "/superadmin/growth" },
    });
  }

  if (ctx.storageDriverUsed) {
    out.push({
      key: "storage",
      status: "ok",
      title: "Storage is shared by what each church holds today",
      detail: "Storage is not recorded month by month, so past months use today's sizes.",
    });
  }
  if (r.partial) {
    out.push({
      key: "partial",
      status: "ok",
      title: "This month is still running",
      detail: "Its bills and plan payments are whole months; its SMS, AI and meetings are so far. Profit rises as the month fills in.",
    });
  }

  return out;
}

/** How many checks need attention, for the tab label. */
export function checksNeedingAttention(checks: Check[]): number {
  return checks.filter((c) => c.status !== "ok").length;
}
