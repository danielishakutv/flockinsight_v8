// Subscription tiers (client-safe). Prices are in Nigerian Naira / month.
// Plans currently drive pricing, targeting and badges; limit enforcement is
// intentionally informational for now (see REVIEW doc).

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
      "Attendance recording & history",
      "Members & groups",
      "Basic giving tracking",
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
      "Giving categories & reports",
      "Follow-up & visitor care",
      "Analytics & trends",
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
      "SMS broadcasts",
      "Advanced analytics & PDF reports",
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
      "Multi-branch / multi-campus",
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
