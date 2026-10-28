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
  | "assistant"
  // --- Growth ---
  | "meetings"
  | "livestreams"
  | "training"
  | "projects"
  | "followUp"
  | "pastoralBooking"
  | "forms"
  | "devotionals"
  | "reminders"
  | "analytics"
  | "aiSummaries"
  | "aiAdvisor"
  | "activityLog"
  | "dataExport"
  | "onlineGiving"
  | "shortLinks"
  | "linkPages"
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
  /*
   * On Starter because it answers questions about the product itself:
   * charging for it would only move the same questions into support tickets.
   * The real gate is the church's AI OPT-IN, which runAi enforces. This key
   * exists so the price list, the upgrade machinery and the action all name
   * the same thing.
   */
  assistant: {
    plan: "starter",
    label: "Help assistant",
    blurb: "Ask how to do anything in FlockInsight and get the steps from our guides.",
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
  /*
   * Beside the shortener, and a tier up from QR codes, for the same honest
   * reason: this is a page WE serve, on our domain, every time somebody opens
   * the link in a church's Instagram bio. A drawing costs us nothing; a hosted
   * public page with a support surface is not free.
   *
   * It is also what makes the shortener worth more than a shortener: one
   * address that holds all the others, and whose contents can change without
   * the bio ever being edited again.
   */
  linkPages: {
    plan: "growth",
    label: "Link pages",
    blurb:
      "One address for all your links — flockinsight.com/hub/yourchurch with your giving page, this Sunday's form, the livestream and your WhatsApp group on it. Pick a style, drop in your own pages from a list, and change what is on it whenever you like.",
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
  /*
   * Growth, beside follow-up, because it is the same promise: somebody is
   * looked after. Texts to the booker are gated separately on `sms` (Pro)
   * inside lib/pastoral-notify.ts. sendChurchSms does NOT check the plan, so
   * the check has to be made there or a Growth church with an approved
   * sender would be texting.
   */
  pastoralBooking: {
    plan: "growth",
    label: "Pastor appointments",
    blurb:
      "Let people book time with a pastor online (counselling, a home visit, prayer) inside the hours each pastor sets, with a confirmation, a reminder and a link to move or cancel it.",
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
  /*
   * The same tier as `analytics`, so a church never gets a summary of numbers
   * its plan cannot chart. The real gate is the owner's opt-in, which runAi
   * enforces; at one summary per church per day the cost is no reason to keep
   * it for Pro.
   */
  aiSummaries: {
    plan: "growth",
    label: "Plain-language summaries",
    blurb:
      "A short read of how your church is doing, written by AI from counts and percentages only. No names ever leave.",
  },
  /*
   * Beside `aiSummaries` and `analytics`, for the same reason: the advisor
   * talks about the figures those two chart, so a church never gets advice
   * about numbers its plan cannot show it. The help half of the same chat
   * stays on Starter (`assistant`). As with every AI feature, the real gate
   * is the owner's opt-in; the plan only decides whether the figures come
   * along.
   */
  aiAdvisor: {
    plan: "growth",
    label: "Church advisor",
    blurb:
      "Ask about your attendance, first-timers, follow-up and giving trends and get recommendations for your ministry, from counts and percentages only.",
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

export type PilotMap = Partial<Record<FeatureKey, readonly string[]>>;

/**
 * Features restricted to named church slugs, whatever their plan says.
 *
 * EMPTY is the normal state. Facilities sat here from 2026-10-06 while it was
 * tried at the team's own church, and was opened to every church on Pro the
 * following day by deleting its line — which is the whole design: a pilot ends
 * by removing one entry, and the tier, the nav entry, the permission and the
 * upgrade prompt were already right.
 */
export const PILOT_ONLY: PilotMap = {};

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
  /*
   * Injectable so the mechanism stays tested when nothing is being piloted,
   * which is most of the time. Without this, emptying PILOT_ONLY would quietly
   * delete the coverage of the gate along with the pilot, and the next person
   * to use it would be relying on code nothing has exercised in months.
   */
  pilots: PilotMap = PILOT_ONLY,
): boolean {
  const allowed = pilots[feature];
  if (!allowed) return true;
  return !!churchSlug && allowed.includes(churchSlug);
}

/** True when this feature is being piloted rather than generally available. */
export function isPilot(
  feature: FeatureKey,
  pilots: PilotMap = PILOT_ONLY,
): boolean {
  return !!pilots[feature];
}

/* ============================================================
 * The live catalogue: what each plan includes TODAY
 *
 * `FEATURES[k].plan` above is the DEFAULT — the tier a feature ships on. A
 * superadmin can tick a feature onto or off any tier at /superadmin/plans,
 * and can make plans of their own (a student fellowship plan) that start
 * from a tier and differ from it.
 *
 * Both are stored as CHANGES, never as full lists. A full list saved today
 * would leave out every module shipped tomorrow, silently and for ever —
 * which is how the public price list once went months without mentioning
 * anything new. As changes, a new feature lands on its default tier
 * everywhere, custom plans included, unless somebody has said otherwise
 * about that feature in particular.
 *
 * The catalogue is plain data so this file stays pure and client-safe:
 * lib/plan-catalog.ts loads it on the server, and every check that decides
 * what a church may do takes it as an argument. There is deliberately no
 * default for that argument on the church checks — a check that forgot to
 * load it would quietly enforce the code defaults instead of the admin's
 * ticks, and nothing would say so.
 * ========================================================== */

/** How a list of features differs from the one it starts from. */
export type FeatureDelta = {
  added: readonly FeatureKey[];
  removed: readonly FeatureKey[];
};

export const NO_DELTA: FeatureDelta = { added: [], removed: [] };

export type CustomPlanEntry = {
  name: string;
  /** The tier it starts from, and what anything it does not set follows. */
  base: PlanId;
  features: readonly FeatureKey[];
};

export type EntitlementCatalog = {
  /** Each tier's live feature list. */
  tiers: Record<PlanId, readonly FeatureKey[]>;
  /** Custom plans by id, archived ones included (churches keep them). */
  custom: Record<string, CustomPlanEntry>;
};

/** Who is asking: a church's tier, and its custom plan if it has one. */
export type PlanHolder = {
  plan: string | null | undefined;
  customPlanId: string | null | undefined;
};

export const ALL_FEATURES = Object.keys(FEATURES) as FeatureKey[];

export function isFeatureKey(k: unknown): k is FeatureKey {
  return typeof k === "string" && Object.prototype.hasOwnProperty.call(FEATURES, k);
}

/**
 * A stored delta, made safe: unknown keys dropped (a feature retired from the
 * code), duplicates removed, and a key never both added and removed.
 */
export function cleanDelta(raw: unknown): FeatureDelta {
  const r = (raw ?? {}) as { added?: unknown; removed?: unknown };
  const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter(isFeatureKey))] : []);
  const added = list(r.added);
  const removed = list(r.removed).filter((k) => !added.includes(k));
  return { added, removed };
}

/** Apply a delta to a list, keeping the order of FEATURES. */
export function applyDelta(base: readonly FeatureKey[], delta: FeatureDelta): FeatureKey[] {
  const set = new Set(base);
  for (const k of delta.added) set.add(k);
  for (const k of delta.removed) set.delete(k);
  return ALL_FEATURES.filter((k) => set.has(k));
}

/**
 * The delta that turns `base` into `target` — what the admin's ticks are
 * saved as. Ticking a feature back to its default produces no entry, so a
 * plan whose boxes all match the default is stored as no change at all.
 */
export function deltaBetween(
  base: readonly FeatureKey[],
  target: readonly FeatureKey[],
): FeatureDelta {
  const b = new Set(base);
  const t = new Set(target.filter(isFeatureKey));
  return {
    added: ALL_FEATURES.filter((k) => t.has(k) && !b.has(k)),
    removed: ALL_FEATURES.filter((k) => b.has(k) && !t.has(k)),
  };
}

/** The code's own answer for a tier: every feature whose default tier it reaches. */
export function defaultTierFeatures(tier: PlanId): FeatureKey[] {
  return ALL_FEATURES.filter((k) => planRank(tier) >= planRank(FEATURES[k].plan));
}

/** Build the catalogue from the stored changes. Pure; tested. */
export function buildCatalog(
  tierDeltas: Partial<Record<PlanId, FeatureDelta>>,
  customPlans: ReadonlyArray<{
    id: string;
    name: string;
    basePlan: string;
    delta: FeatureDelta;
  }>,
): EntitlementCatalog {
  const tiers = Object.fromEntries(
    PLAN_ORDER.map((t) => [t, applyDelta(defaultTierFeatures(t), tierDeltas[t] ?? NO_DELTA)]),
  ) as Record<PlanId, FeatureKey[]>;
  const custom: Record<string, CustomPlanEntry> = {};
  for (const c of customPlans) {
    const base = PLAN_ORDER[planRank(c.basePlan)];
    custom[c.id] = { name: c.name, base, features: applyDelta(tiers[base], c.delta) };
  }
  return { tiers, custom };
}

/** The catalogue with nothing changed — what a fresh install enforces, and what tests use. */
export const DEFAULT_CATALOG: EntitlementCatalog = buildCatalog({}, []);

/**
 * Everything a church's plan includes.
 *
 * A custom plan the catalogue does not know (a bad id) falls back to the
 * church's tier, which for a custom-plan church is the plan's base tier — the
 * smaller of the two possible readings, never "everything".
 */
export function holderFeatures(
  holder: PlanHolder,
  catalog: EntitlementCatalog,
): readonly FeatureKey[] {
  const custom = holder.customPlanId ? catalog.custom[holder.customPlanId] : undefined;
  if (custom) return custom.features;
  return catalog.tiers[PLAN_ORDER[planRank(holder.plan)]];
}

export function holderIncludes(
  holder: PlanHolder,
  feature: FeatureKey,
  catalog: EntitlementCatalog,
): boolean {
  return holderFeatures(holder, catalog).includes(feature);
}

/**
 * The whole question: may THIS church use this feature?
 *
 * Plan AND pilot. Both have to say yes, so a pilot cannot accidentally hand a
 * Starter church a Pro module, and a Pro plan cannot reach a module that is
 * still being tried out somewhere else.
 */
export function churchHasFeature(
  church: PlanHolder & { slug: string | null | undefined },
  feature: FeatureKey,
  catalog: EntitlementCatalog,
  pilots: PilotMap = PILOT_ONLY,
): boolean {
  return holderIncludes(church, feature, catalog) && pilotAllows(feature, church.slug, pilots);
}

/**
 * The same question for a church ROW, on a path with no signed-in church for
 * `hasFeature` to read — a public link that writes into a church's records
 * answers to that church's plan, not the visitor's.
 *
 * The demonstration church shows everything, whatever the ticks say, exactly
 * as `activePlan` treats it, so its public pages work the way its signed-in
 * pages do. Pilots still apply: the demo is not a pilot church.
 */
export function churchRowHasFeature(
  row: PlanHolder & { slug: string | null; isDemo: boolean | null },
  feature: FeatureKey,
  catalog: EntitlementCatalog,
  pilots: PilotMap = PILOT_ONLY,
): boolean {
  if (row.isDemo) return pilotAllows(feature, row.slug, pilots);
  return churchHasFeature(row, feature, catalog, pilots);
}

/** The tier a feature ships on — the code's default, before any ticks. */
export function minPlanFor(feature: FeatureKey): PlanId {
  return FEATURES[feature].plan;
}

/** The lowest tier whose LIVE list includes a feature, or null if none does. */
export function lowestTierWith(feature: FeatureKey, catalog: EntitlementCatalog): PlanId | null {
  return PLAN_ORDER.find((t) => catalog.tiers[t].includes(feature)) ?? null;
}

/**
 * Whether a TIER includes a feature. Defaults to the code's catalogue, which
 * is what the tests pin down. Anything deciding what a real church may do
 * goes through `churchHasFeature` with the live catalogue instead —
 * entitlements.test.ts fails the build if product code calls this.
 */
export function planIncludes(
  plan: string | null | undefined,
  feature: FeatureKey,
  catalog: EntitlementCatalog = DEFAULT_CATALOG,
): boolean {
  return catalog.tiers[PLAN_ORDER[planRank(plan)]].includes(feature);
}

/**
 * The name of the plan a church would have to be on, for a prompt. Falls back
 * to the default tier when an admin has ticked the feature off every tier —
 * the prompt still has to name something.
 */
export function planNameFor(
  feature: FeatureKey,
  catalog: EntitlementCatalog = DEFAULT_CATALOG,
): string {
  const tier = lowestTierWith(feature, catalog) ?? minPlanFor(feature);
  return PLAN_BY_ID[tier]?.name ?? tier;
}

/**
 * One sentence for a refused write.
 *
 * Says what the feature is and which plan has it, because "not permitted" sends
 * somebody to their church administrator to ask about a permission they do have.
 */
export function upgradeMessage(
  feature: FeatureKey,
  catalog: EntitlementCatalog = DEFAULT_CATALOG,
): string {
  const f = FEATURES[feature];
  const tier = lowestTierWith(feature, catalog);
  if (!tier) return `${f.label} isn't included in your plan. ${f.blurb}`;
  return `${f.label} is on the ${PLAN_BY_ID[tier]?.name ?? tier} plan. ${f.blurb}`;
}

/**
 * The menu's chips: for each feature this church does NOT have, the plan name
 * to put beside it. Worked out on the server and handed to the menu, so the
 * menu reads the same live ticks the server enforces.
 */
export function planChipsFor(
  holder: PlanHolder,
  catalog: EntitlementCatalog,
): Partial<Record<FeatureKey, string>> {
  const has = new Set(holderFeatures(holder, catalog));
  const out: Partial<Record<FeatureKey, string>> = {};
  for (const k of ALL_FEATURES) if (!has.has(k)) out[k] = planNameFor(k, catalog);
  return out;
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

/* ============================================================
 * Assistant allowances
 *
 * Questions, not money: a church reads "37 of 150 left this month", which a
 * dollar ceiling could never say. The money ceilings in lib/ai/settings.ts
 * stay underneath as the backstop. These are the defaults; an admin can
 * override them in platform_setting `assistant_allowances`, and
 * lib/ai/settings-rules.ts falls back to these whenever that cannot be read.
 * ========================================================== */

/** Questions a church may ask in a calendar month (UTC). Null means no ceiling. */
export const ASSISTANT_QUESTIONS_BY_PLAN: Record<PlanId, number | null> = {
  starter: 30,
  growth: 150,
  pro: 500,
  enterprise: 2000,
};

/** Questions one person may ask in a day (UTC), whatever the church's plan. */
export const ASSISTANT_PERSON_DAILY = 25;

/**
 * A superadmin's day, on the platform's budget. Higher than a church
 * member's because support work is asking on someone else's behalf all day.
 */
export const ASSISTANT_ADMIN_DAILY = 60;

/**
 * A plan's monthly question allowance, or null for no ceiling.
 *
 * Key presence, not `??`, for the same reason as teamLimitFor: null means
 * unlimited, and `null ?? 30` is 30. An unknown plan reads as the smallest
 * plan, never the largest.
 */
export function assistantQuestionsFor(
  plan: string | null | undefined,
  byPlan: Record<PlanId, number | null> = ASSISTANT_QUESTIONS_BY_PLAN,
): number | null {
  const id = PLAN_ORDER[planRank(plan)];
  return id in byPlan ? byPlan[id] : byPlan.starter;
}

/** Every feature a tier includes — for the settings page, and for tests. */
export function featuresFor(
  plan: string | null | undefined,
  catalog: EntitlementCatalog = DEFAULT_CATALOG,
): FeatureKey[] {
  return [...catalog.tiers[PLAN_ORDER[planRank(plan)]]];
}
