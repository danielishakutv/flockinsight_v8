// Subscription tiers (client-safe). Prices are in Nigerian Naira / month.
//
// WHAT THE NUMBERS ARE FOR. The allowances here are not arbitrary generosity —
// they are the difference between this platform paying for itself and not.
// Two suppliers set the shape, and they behave very differently:
//
//   Cloudinary  roughly one credit per GB stored per month, 25 credits free,
//               and then a CLIFF to $99/month. Storage is the cost that never
//               goes away and the one that steps rather than slopes, so what
//               each plan may KEEP is the main lever there is.
//   ZeptoMail   1 credit = 10,000 emails, pay-as-you-go, first credit free,
//               no monthly commitment. Email is therefore a gentle per-send
//               cost rather than a tier to fall off, which is why these
//               allowances can be generous where storage cannot.
//
// The asymmetry is the whole point: an extra thousand emails costs pennies,
// an extra gigabyte per church across forty churches is the difference
// between $0 and $99 a month. Raising a storage number is a decision about
// the bill; raising an email number mostly is not.
//
// These values are the DEFAULTS. The live numbers are admin-editable at
// /superadmin/pricing (lib/pricing.ts), so a supplier's price change is
// answered from a phone rather than from a deploy.
//
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
    emailAllowance: 300,
    features: [
      "Up to 150 members",
      "200 MB for photos & documents",
      "Attendance in seconds, with history and trends",
      "Members, households & children",
      "Groups, ministries & home cells",
      "Offerings & tithes by category",
      "Group contributions — one shareable link showing every naira a department has collected",
      "Your own public church page & events",
      "300 emails a month",
      "Birthday & anniversary greetings by email",
      "Earn wallet credit for every church you refer",
      "1 admin account",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    tagline: "For growing churches that want real insight.",
    priceMonthly: 5000,
    memberLimit: 1000,
    emailAllowance: 1500,
    highlight: true,
    features: [
      "Up to 1,000 members",
      "Everything in Starter",
      "500 MB media storage",
      "1,500 emails a month",
      "Training & classes — Foundation, Baptism, Pre-Marital, leadership, with badges beside members' names",
      "Virtual meetings — video, audio, screen sharing and scripture on screen, straight from a browser. Built for weak connections, with a one-tap audio-only mode. Up to 25 people, 8 hours a month",
      "Building projects & pledge tracking",
      "Group contributions with receipts, two-signature checks and a record of where the money went",
      "First-timer follow-up & visitor care",
      "Forms with a shareable link & QR code",
      "Devotionals & newsletters by email",
      "Automatic service reminders",
      "Analytics & growth trends",
      "CSV import / export",
      "Livestream from YouTube or Facebook onto your own watch page",
      "Up to 10 team members & custom roles",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For established churches running at scale.",
    priceMonthly: 15000,
    memberLimit: null,
    emailAllowance: 5000,
    features: [
      "Unlimited members",
      "Everything in Growth",
      "2 GB media storage",
      "5,000 emails a month",
      "Meetings for up to 100 people, 30 hours a month",
      "Church finance — income, expenses, accounts & funds that fill themselves from giving",
      "Bulk SMS with your church's own sender ID",
      "Sermon & media library",
      "Record your meetings and keep them in the media library for 90 days",
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
      "20 GB media storage, and email volume to suit",
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
