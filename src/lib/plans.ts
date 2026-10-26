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
// WHICH MEANS: EDITING THIS FILE MAY CHANGE NOTHING ON THE WEBSITE. A saved
// override in platform_setting wins over everything here, for ever, silently.
// The live pricing page spent months advertising "Up to 70 members" and "Basic
// giving tracking" — neither of which had existed in this file for a long time —
// because somebody had once pressed Save on a feature list, and not one module
// shipped afterwards ever appeared. After changing anything here, check
// /superadmin/pricing: a plan showing "Edited" is not reading this file, and
// "Use the built-in copy" is what hands it back.
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
    // Not free: the launch promo makes the first 7 Sundays free, which is what
    // the pricing page strikes through. A default of 0 here would have the
    // landing page say "Free" the moment anybody cleared the price override.
    priceMonthly: 5000,
    memberLimit: 150,
    emailAllowance: 300,
    features: [
      "Up to 150 members",
      "Attendance in seconds, with history and trends",
      "Members, households & children — with birthdays, anniversaries and notes",
      "Groups, ministries & home cells",
      "Offerings & tithes by category",
      "Group contributions — one shareable link showing every naira a department has collected",
      "Photo studio — put your logo on a whole service's photographs at once, add the date, shrink them for WhatsApp and download the lot as a zip. Works on a phone, with no upload and no waiting",
      "QR codes — for your giving page, a form, your WiFi, a programme. Your logo in the middle, your own colours, and a check that tells you whether it will really scan before you print four hundred of them",
      // A price-list claim: ship it only with ANTHROPIC_API_KEY set on the
      // server and the AI kill switch off. Advertising a feature nobody can
      // turn on is the overstatement FORBIDDEN_CLAIMS exists to prevent.
      "Help assistant — 30 questions a month: ask in your own words how to do something in FlockInsight and get the steps from our guides. Chats are kept on their own page. Answers are written by an AI model, show the guide they came from and can be wrong. Off until you turn it on",
      "Your own public church page, with events people can register for",
      "Birthday & anniversary greetings by email",
      "Earn wallet credit for every church you refer",
      // Starter has one admin account, so this must not promise "everyone on
      // your team"; the higher plans inherit it through "Everything in Starter".
      "The FlockInsight course: a short quiz with every guide. Pass them all and you are a certified FlockInsight Professional, with a PDF certificate anyone can check online. Master and Expert follow as you really use it",
      "1 admin account",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    tagline: "For growing churches that want real insight.",
    priceMonthly: 10000,
    memberLimit: 1000,
    emailAllowance: 1500,
    highlight: true,
    features: [
      "Up to 1,000 members",
      "Everything in Starter",
      "Online giving \u2014 take offerings and tithes through your own Paystack, Flutterwave or Monnify account, from one shareable link. The money goes straight to your own bank account; we take nothing",
      "Virtual meetings (beta) — video, audio, screen sharing and scripture on screen, straight from a browser. Built for weak connections, with a one-tap audio-only mode. Up to 50 people in a room",
      "Training & classes — Foundation, Baptism, Pre-Marital, leadership, with badges beside members' names",
      "Building projects & pledge tracking",
      "Group contributions with receipts, two-signature checks and a record of where the money went",
      "First-timer follow-up & visitor care",
      "Pastor appointments: people book counselling, a home visit or prayer with a pastor from your own booking page, inside the hours each pastor sets. A confirmation and a reminder by email (and by text on Pro), and a link to move or cancel it",
      "Short links — flockinsight.com/l/give on a poster or read from the front, and you can change where it goes afterwards without reprinting anything. With a count of how many followed it and whether they scanned or typed it",
      "Link pages — one address that holds all the others, like flockinsight.com/hub/yourchurch. Choose a style, add your own giving pages, forms, livestream and events from a list, or any other link, and change what is on it without touching your bio again",
      "Forms with a shareable link & QR code, and answers matched to the member who sent them",
      "Devotionals & newsletters your members can subscribe to",
      "Automatic service reminders by email",
      "Analytics & growth trends",
      "Plain-language summaries: a short read of your attendance, growth, giving trend and first-timers, written by AI from counts and percentages only. Off until you turn it on, and no names, phone numbers or notes ever leave FlockInsight",
      "Church advisor — 150 questions a month: ask about your attendance, first-timers, follow-up and giving trends and get recommendations for your ministry. Answers can be saved and downloaded as PDF. Uses counts and percentages only, written by an AI model and can be wrong. Off until you turn it on",
      "Livestream from YouTube or Facebook onto your own watch page",
      "Give a member a staff login with exactly the access you choose",
      "Activity log — who changed what, across every module",
      "CSV import / export",
      "Up to 10 team members & custom roles",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For established churches running at scale.",
    priceMonthly: 25000,
    memberLimit: null,
    emailAllowance: 5000,
    features: [
      "Unlimited members",
      "Everything in Growth",
      "Meetings for up to 200 people",
      "Repeating meetings — set Wednesday prayer up once and it runs every week, with the same link every time",
      "Record a meeting and keep it in the media library",
      "Church finance — income, expenses, accounts & funds that fill themselves from giving",
      "Bulk SMS with your church's own sender ID",
      "Sermon & media library — audio, video and slides, with your own watch pages",
      "Reports centre: 31 datasets as CSV or PDF, plus a full export of everything",
      "Branded PDFs carrying your logo & colours",
      "Facilities — book the hall, the rooms and the bus on one calendar, with clashes refused and hire fees recorded",
      "Church advisor with 500 questions a month",
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
      "Church advisor with 2,000 questions a month",
      "For churches outside Nigeria: your own currency, timezone and language",
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
