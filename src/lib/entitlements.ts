/**
 * What each plan actually includes — the price list, as code.
 *
 * Pure and client-safe: the nav, a page, a server action and a test all read the
 * same map, so there is exactly one answer to "is this church allowed to do
 * this" and it cannot drift between the marketing copy and the product.
 *
 * WHY THIS EXISTS. Until now the tiers were a promise and almost nothing
 * checked them. Only the member count, the storage quota, the email allowance
 * and a meeting's room size were enforced; every module was open to every
 * church whatever they paid. A price list nothing honours is not a price list,
 * it is a brochure.
 *
 * TWO RULES, AND THE SECOND ONE MATTERS MORE.
 *
 *   1. A feature outside the plan cannot be USED. Every write is refused on the
 *      server, not merely hidden — a hidden button is not a locked door.
 *
 *   2. Nothing a church has already entered becomes unreachable. Five live
 *      churches had records in modules their plan does not cover, including one
 *      with 201 members and one with 155. Taking their own books away to make a
 *      point about billing would be indistinguishable, to them, from losing the
 *      data. So those pages stay READABLE, clearly marked, with the writes shut
 *      and an upgrade prompt saying what it would take.
 *
 * This is the same shape as the member limit, which has always blocked the next
 * add without deleting anybody (see lib/plan-limits.ts).
 */

import { PLAN_BY_ID, type PlanId } from "@/lib/plans";

/* ============================================================
 * Ranking
 * ========================================================== */

/**
 * Plans in order of what they include. Used for "at least this plan", which is
 * how every line of the price list is actually worded ("Everything in Growth").
 */
export const PLAN_ORDER: PlanId[] = ["starter", "growth", "pro", "enterprise"];

/**
 * An unknown plan id ranks LOWEST, on purpose.
 *
 * A typo or a new plan nobody has mapped yet is a bug, and the safe reading of a
 * bug is the smallest allowance — never "this church may do everything".
 */
export function planRank(plan: string | null | undefined): number {
  const i = PLAN_ORDER.indexOf((plan ?? "") as PlanId);
  return i < 0 ? 0 : i;
}

/* ============================================================
 * The features
 *
 * One key per thing the price list names. Keys are what the code says, the
 * labels here are what a church is shown, and both live together so an upgrade
 * prompt can never advertise a feature by a name nobody uses.
 * ========================================================== */

export type FeatureKey =
  // --- Starter: everything the entry plan advertises ---
  | "members"
  | "attendance"
  | "groups"
  | "giving"
  | "contributions"
  | "events"
  | "celebrations"
  | "email"
  | "photoStudio"
  | "qrCodes"
  // --- Growth ---
  | "meetings"
  | "livestreams"
  | "training"
  | "projects"
  | "followUp"
  | "forms"
  | "devotionals"
  | "reminders"
  | "analytics"
  | "activityLog"
  | "dataExport"
  | "onlineGiving"
  | "shortLinks"
  // --- Pro ---
  | "meetings.repeat"
  | "meetings.record"
  | "finance"
  | "sms"
  | "mediaLibrary"
  | "reports"
  | "brandedPdf"
  | "facilities"
  // --- Enterprise ---
  | "branches";

export type FeatureMeta = {
  /** The lowest plan that includes it. */
  plan: PlanId;
  /** What it is called where a church reads about it. */
  label: string;
  /** One line for an upgrade prompt: what they would get, not what they lack. */
  blurb: string;
};

/**
 * Taken from the live price list, line by line. Changing a tier here changes the
 * product, the nav and the upgrade prompts together — which is the point.
 */
export const FEATURES: Record<FeatureKey, FeatureMeta> = {
  /* ---------------------------------------------------- Starter */
  members: {
    plan: "starter",
    label: "Members",
    blurb: "Members, households and children, with birthdays and notes.",
  },
  attendance: {
    plan: "starter",
    label: "Attendance",
    blurb: "Attendance in seconds, with history and trends.",
  },
  groups: {
    plan: "starter",
    label: "Groups",
    blurb: "Groups, ministries and home cells.",
  },
  giving: {
    plan: "starter",
    label: "Giving",
    blurb: "Offerings and tithes by category.",
  },
  contributions: {
    plan: "starter",
    label: "Group contributions",
    blurb: "One shareable link showing every naira a department has collected.",
  },
  events: {
    plan: "starter",
    label: "Events",
    blurb: "Your own public church page, with events people can register for.",
  },
  celebrations: {
    plan: "starter",
    label: "Celebrations",
    blurb: "Birthday and anniversary greetings by email.",
  },
  email: {
    plan: "starter",
    label: "Email",
    blurb: "Email your members, within your plan's monthly allowance.",
  },
  /*
   * On the SMALLEST plan, deliberately, and it is the only module here that
   * costs nothing to serve: every pixel is processed on the church's own
   * device, so a thousand churches watermarking a thousand services uses no
   * CPU, no bandwidth and no storage of ours.
   *
   * Which makes it the wrong thing to charge for and the right thing to give
   * away — a church with no designer gets something it would otherwise pay a
   * person for, and the entry plan becomes markedly more generous for free.
   * Moving it up a tier is a one-word change here if that ever stops being
   * true.
   */
  photoStudio: {
    plan: "starter",
    label: "Photo studio",
    blurb:
      "Put your logo on a whole service's photographs at once, shrink them for sharing, and download them as a zip \u2014 all on your own phone.",
  },


  /*
   * ON STARTER FOR THE SAME REASON AS THE PHOTO STUDIO, and the reason is
   * worth being precise about, because the other half of this module is not.
   *
   * Drawing a QR code costs us nothing at all. The encoder, the renderer and
   * the scannability checks are pure functions that run on the church's own
   * device: a thousand churches making a thousand codes uses no CPU of ours,
   * no bandwidth and no storage, and the SVG and the PNG are both built and
   * saved in the browser. So it is the wrong thing to charge for and the right
   * thing to give away \u2014 and the price list has promised forms "with a
   * shareable link and QR code" since Growth launched, which until now was a
   * promise nothing in the product kept.
   */
  qrCodes: {
    plan: "starter",
    label: "QR codes",
    blurb:
      "Make a QR code for anything \u2014 your giving page, a form, your WiFi, a programme \u2014 with your logo in the middle and your own colours, checked to be sure it will actually scan.",
  },

  /* ---------------------------------------------------- Growth */
  /*
   * THE SHORTENER IS NOT FREE, and the difference from `qrCodes` above is the
   * honest reason it sits a tier up: a short link is a redirect WE serve, on
   * our domain, on every scan of every poster, for as long as the poster
   * exists \u2014 with a row written each time. That is a hosted service with a
   * running cost and a support surface, not a drawing.
   *
   * It is also what makes a printed QR code worth printing, because the
   * destination stays editable after the flyers are out. Which makes this the
   * clearest upgrade reason on the price list: not "more of the same", but
   * "the decision you are about to print becomes reversible".
   */
  shortLinks: {
    plan: "growth",
    label: "Short links",
    blurb:
      "Short, memorable links for a poster or a pulpit announcement \u2014 and you can change where each one goes afterwards, without reprinting anything. With a count of how many followed it, and whether they scanned or typed it.",
  },
  onlineGiving: {
    plan: "growth",
    label: "Online giving",
    blurb:
      "Take offerings and tithes online through your own Paystack, Flutterwave or Monnify account \u2014 one shareable link, and the money lands in your own bank account.",
  },
  meetings: {
    plan: "growth",
    label: "Virtual meetings",
    blurb:
      "Hold a meeting in the browser — video, audio, screen sharing and scripture on screen, built for weak connections.",
  },
  livestreams: {
    plan: "growth",
    label: "Livestreams",
    blurb: "Put your YouTube or Facebook stream on your own watch page.",
  },
  training: {
    plan: "growth",
    label: "Training & classes",
    blurb:
      "Foundation, Baptism, Pre-Marital and leadership classes, with badges beside members' names.",
  },
  projects: {
    plan: "growth",
    label: "Building projects & pledges",
    blurb: "Track a building project and the pledges made towards it.",
  },
  followUp: {
    plan: "growth",
    label: "Follow-up",
    blurb: "First-timer follow-up and visitor care.",
  },
  forms: {
    plan: "growth",
    label: "Forms",
    blurb:
      "Forms with a shareable link and QR code, and answers matched to the member who sent them.",
  },
  devotionals: {
    plan: "growth",
    label: "Devotionals & newsletters",
    blurb: "Devotionals and newsletters your members can subscribe to.",
  },
  reminders: {
    plan: "growth",
    label: "Service reminders",
    blurb: "Automatic service reminders by email.",
  },
  analytics: {
    plan: "growth",
    label: "Analytics",
    blurb: "Analytics and growth trends across everything you record.",
  },
  activityLog: {
    plan: "growth",
    label: "Activity log",
    blurb: "Who changed what, across every module.",
  },
  dataExport: {
    plan: "growth",
    label: "Import & export",
    blurb: "Bring your records in, and take them out again, as CSV.",
  },

  /* ---------------------------------------------------- Pro */
  "meetings.repeat": {
    plan: "pro",
    label: "Repeating meetings",
    blurb:
      "Set Wednesday prayer up once and it runs every week, with the same link every time.",
  },
  "meetings.record": {
    plan: "pro",
    label: "Meeting recordings",
    blurb: "Record a meeting and keep it in the media library.",
  },
  finance: {
    plan: "pro",
    label: "Church finance",
    blurb:
      "Income, expenses, accounts and funds that fill themselves from your giving records.",
  },
  sms: {
    plan: "pro",
    label: "Bulk SMS",
    blurb: "Text your members from your church's own sender ID.",
  },
  mediaLibrary: {
    plan: "pro",
    label: "Sermon & media library",
    blurb: "Keep sermons — audio, video and slides — with your own watch pages.",
  },
  reports: {
    plan: "pro",
    label: "Reports centre",
    blurb: "31 datasets as CSV or PDF, plus a full export of everything.",
  },
  brandedPdf: {
    plan: "pro",
    label: "Branded PDFs",
    blurb: "Every PDF carrying your own logo and colours.",
  },

  /* ---------------------------------------------------- Enterprise */
  facilities: {
    plan: "pro",
    label: "Facilities",
    blurb:
      "Your halls, rooms, grounds and equipment — booked on one calendar, with clashes refused and hire fees recorded.",
  },
  branches: {
    plan: "enterprise",
    label: "Branches & denominations",
    blurb:
      "One report across every branch, grouped by zone, with weekly or monthly summaries by email.",
  },
};

/* ============================================================
 * Pilots
 *
 * A module that is finished but has never met a real church is not ready for
 * every church. This is how one gets tried somewhere first: the feature keeps
 * its proper tier, and on top of that only the named churches can reach it.
 *
 * Rolling it out to everybody is deleting one line from this map. Nothing else
 * changes — the tier, the nav entry, the permission and the upgrade prompt are
 * already right.
 * ========================================================== */

/** Features restricted to named church slugs, whatever their plan says. */
export const PILOT_ONLY: Partial<Record<FeatureKey, readonly string[]>> = {
  // Facilities ships to the team's own church first. Remove this line to open
  // it to every church on Pro and above.
  facilities: ["flockinsight-church"],
};

/**
 * Whether a pilot lets this church in.
 *
 * True for anything that is not a pilot at all, so the ordinary path is
 * unaffected. An unknown slug is refused rather than waved through: the safe
 * reading of "we do not know which church this is" is the smaller allowance,
 * the same way `planRank` treats an unknown plan.
 */
export function pilotAllows(
  feature: FeatureKey,
  churchSlug: string | null | undefined,
): boolean {
  const allowed = PILOT_ONLY[feature];
  if (!allowed) return true;
  return !!churchSlug && allowed.includes(churchSlug);
}

/** True when this feature is being piloted rather than generally available. */
export function isPilot(feature: FeatureKey): boolean {
  return !!PILOT_ONLY[feature];
}

/**
 * The whole question: may THIS church use this feature?
 *
 * Plan AND pilot. Both have to say yes, so a pilot cannot accidentally hand a
 * Starter church a Pro module, and a Pro plan cannot reach a module that is
 * still being tried out somewhere else.
 */
export function churchHasFeature(
  plan: string | null | undefined,
  churchSlug: string | null | undefined,
  feature: FeatureKey,
): boolean {
  return planIncludes(plan, feature) && pilotAllows(feature, churchSlug);
}

/** The lowest plan that includes a feature. */
export function minPlanFor(feature: FeatureKey): PlanId {
  return FEATURES[feature].plan;
}

/** Whether a plan includes a feature. */
export function planIncludes(
  plan: string | null | undefined,
  feature: FeatureKey,
): boolean {
  return planRank(plan) >= planRank(minPlanFor(feature));
}

/** The name of the plan a church would have to be on, for a prompt. */
export function planNameFor(feature: FeatureKey): string {
  return PLAN_BY_ID[minPlanFor(feature)]?.name ?? minPlanFor(feature);
}

/**
 * One sentence for a refused write.
 *
 * Says what the feature is and which plan has it, because "not permitted" sends
 * somebody to their church administrator to ask about a permission they do have.
 */
export function upgradeMessage(feature: FeatureKey): string {
  const f = FEATURES[feature];
  return `${f.label} is on the ${planNameFor(feature)} plan. ${f.blurb}`;
}

/* ============================================================
 * Team size
 *
 * A limit rather than a feature: every plan may have staff, they differ in how
 * many. Advertised since the beginning and enforced nowhere, which is why one
 * church is on Starter with twelve admins.
 * ========================================================== */

export const TEAM_LIMIT_BY_PLAN: Record<PlanId, number | null> = {
  starter: 1,
  growth: 10,
  pro: null,
  enterprise: null,
};

/**
 * How many staff a plan allows, or null for no ceiling.
 *
 * Key presence, not `??`. `null` here means unlimited, and `null ?? 1` is 1 — so
 * the obvious version of this function quietly made Pro a one-admin plan. Same
 * trap as the email allowance, where an empty override means "no opinion" rather
 * than "no emails".
 */
export function teamLimitFor(plan: string | null | undefined): number | null {
  const id = PLAN_ORDER[planRank(plan)];
  return id in TEAM_LIMIT_BY_PLAN ? TEAM_LIMIT_BY_PLAN[id] : 1;
}

/** Every feature a plan includes — for the settings page, and for tests. */
export function featuresFor(plan: string | null | undefined): FeatureKey[] {
  return (Object.keys(FEATURES) as FeatureKey[]).filter((k) => planIncludes(plan, k));
}
