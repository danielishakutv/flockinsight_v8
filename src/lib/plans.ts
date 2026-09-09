// Subscription tiers (client-safe). Prices are in Nigerian Naira / month.
//
// IMPORTANT: only `memberLimit` and `emailAllowance` are actually enforced
// (lib/plan-limits.ts). Every module is open on every plan. So `features` is
// marketing copy describing what a church is BUYING INTO, not a gate — a
// Starter church can still open Finance today.
//
// Keep this list current. When a module ships it belongs on a tier here and on
// the pricing page, or churches never learn it exists and it drives no
// upgrades. The list is also the default behind the admin-editable copy in
// lib/pricing.ts, so what is written here is what a new deployment shows.

export type PlanId = "starter" | "growth" | "pro" | "enterprise";

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  /** Monthly price in NGN. null = custom / contact sales. */
  priceMonthly: number | null;
  memberLimit: number | null; // null = unlimited
  /** Included emails per calendar month. null = unlimited. */
  emailAllowance: number | null;
  highlight?: boolean;
  features: string[];
};

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "For new and small churches finding their feet.",
    priceMonthly: 0,
    memberLimit: 150,
    emailAllowance: 500,
    features: [
      "Up to 150 members",
      "Attendance in seconds, with history and trends",
      "Members, households & children",
      "Groups, ministries & home cells",
      "Offerings & tithes by category",
      "Your own public church page & events",
      "Birthday & anniversary greetings by email",
      "1 admin account",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    tagline: "For growing churches that want real insight.",
    priceMonthly: 5000,
    memberLimit: 1000,
    emailAllowance: 3000,
    highlight: true,
    features: [
      "Up to 1,000 members",
      "Everything in Starter",
      "Training & classes — Foundation, Baptism, Pre-Marital, leadership, with badges beside members' names",
      "Building projects & pledge tracking",
      "First-timer follow-up & visitor care",
      "Forms with a shareable link & QR code",
      "Devotionals & newsletters by email",
      "Automatic service reminders",
      "Analytics & growth trends",
      "CSV import / export",
      "Up to 10 team members & custom roles",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For established churches running at scale.",
    priceMonthly: 15000,
    memberLimit: null,
    emailAllowance: 15000,
    features: [
      "Unlimited members",
      "Everything in Growth",
      "Church finance — income, expenses, accounts & funds that fill themselves from giving",
      "Bulk SMS with your church's own sender ID",
      "Sermon & media library",
      "Reports centre: 31 datasets as CSV or PDF, plus a full export",
      "Branded PDFs carrying your logo & colours",
      "Unlimited team members & roles",
      "Priority support",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For denominations & multi-branch ministries.",
    priceMonthly: null,
    memberLimit: null,
    emailAllowance: null,
    features: [
      "Everything in Pro",
      "Branches & denominations — one report across every branch, grouped by zone",
      "Automatic weekly or monthly branch reports by email",
      "Dedicated account manager",
      "Custom integrations & onboarding",
      "Service-level agreement (SLA)",
    ],
  },
];

export const PLAN_BY_ID: Record<PlanId, Plan> = Object.fromEntries(
  PLANS.map((p) => [p.id, p]),
) as Record<PlanId, Plan>;

export function planName(id: string): string {
  return PLAN_BY_ID[id as PlanId]?.name ?? id;
}

/** Included emails per month for a plan (null = unlimited). */
export function emailAllowanceFor(id: string): number | null {
  const p = PLAN_BY_ID[id as PlanId];
  return p ? p.emailAllowance : 500;
}

export function planPriceLabel(p: Plan): string {
  if (p.priceMonthly === null) return "Custom";
  if (p.priceMonthly === 0) return "Free";
  return `₦${p.priceMonthly.toLocaleString()}/mo`;
}
