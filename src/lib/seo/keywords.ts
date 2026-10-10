/**
 * The keyword and entity map. This file is the research, committed.
 *
 * It exists because keyword decisions kept being made inside page copy, where
 * nobody could see them, review them, or tell whether two pages were quietly
 * competing for the same phrase. Every public page that targets a search term
 * now takes it from here, so the strategy is one file you can read in a sitting
 * rather than something reconstructed by grepping headlines.
 *
 * Three rules this file follows, all of them learned from how search and AI
 * assistants actually behave in 2026:
 *
 * 1. **Do not fight for words you cannot win.** "church management software"
 *    is owned by Planning Center, Breeze/Tithely, ChMeetings and ChurchSuite,
 *    all with a decade of domain authority. We say it — you must, it is the
 *    category — but we do not build the business on it. We build on terms
 *    where the incumbent page is thin or does not exist.
 *
 * 2. **One page, one primary term.** Two pages chasing the same phrase split
 *    their own authority and Google picks the worse one. `primary` is unique
 *    across this file, and `keywords.test.ts` fails the build if it is not.
 *
 * 3. **Every term must be answerable truthfully by the product.** A page that
 *    ranks for something we do not do is a bounce, and an AI assistant that
 *    catches the site overstating itself discounts everything else on it.
 *    Each entry names the modules that back the claim.
 */

/** Which bucket a term sits in. Decides how hard we chase it and from where. */
export type TermTier =
  /**
   * The category name. Enormous volume, unwinnable head-on, mandatory anyway:
   * it is what the page has to be *about* for anything else to make sense, and
   * it is the phrase an AI assistant matches us against when someone asks the
   * generic question.
   */
  | "category"
  /**
   * A phrase that describes what we are but that nobody has claimed, because
   * no competitor is the whole thing. We are an 18-module operations platform;
   * the field sells a member database with giving bolted on. These terms are
   * cheap now and expensive later, so they go in headlines.
   */
  | "position"
  /** "... in Nigeria", "... in Kenya". Winnable, high intent, local rivals are thin. */
  | "geographic"
  /** A single job: attendance, follow-up, bulk SMS. Lower volume, buyer already knows what they want. */
  | "useCase"
  /** "X alternative", "free church management software". Highest intent on the internet. */
  | "comparison"
  /**
   * Something true of us and of almost nobody else: works on a bad connection,
   * holds 40+ currencies, sends from the church's own SMS sender ID. Tiny
   * volume, near-zero competition, and the person searching it has already
   * been failed by somebody else's product.
   */
  | "differentiator";

export type SeoTerm = {
  /** The exact phrase. Lowercase; pages title-case it themselves. */
  primary: string;
  tier: TermTier;
  /**
   * Phrases to work into the same page naturally. These are variants and
   * near-synonyms, not a stuffing list — they belong in sentences, and the
   * `keywords` meta tag is a dead ranking signal we fill only because AI
   * crawlers do still read it.
   */
  variants: string[];
  /**
   * The question a person types into an assistant, as a sentence. This is the
   * AIEO half: assistants retrieve against the question, not the keyword, so
   * the page has to contain a direct answer to this sentence. Used to generate
   * the FAQ and the summary paragraph.
   */
  question: string;
  /** Modules that make the claim true. If this is empty, we do not build the page. */
  backedBy: string[];
  /** Who already ranks here, so a comparison page does not pretend otherwise. */
  incumbents?: string[];
};

/**
 * The category terms. We rank for these eventually, by accumulating the rest.
 *
 * Note what is deliberately absent: "free church management software". It
 * belongs in `comparison`, not here, because the honest answer is that we are
 * free for seven Sundays and then priced — and a page that chases the word
 * "free" with a paid product earns one visit and no trust.
 */
export const CATEGORY_TERMS: SeoTerm[] = [
  {
    primary: "church management software",
    tier: "category",
    variants: [
      "church management system",
      "ChMS",
      "church software",
      "church management app",
      "software for churches",
    ],
    question: "What is the best church management software?",
    backedBy: ["members", "attendance", "giving", "finance", "groups", "comms"],
    incumbents: ["Planning Center", "Breeze ChMS", "ChMeetings", "ChurchSuite", "Tithe.ly"],
  },
  {
    primary: "church administration software",
    tier: "category",
    variants: [
      "church admin software",
      "church office software",
      "church secretary software",
      "church records management",
    ],
    question: "What software do churches use to run their administration?",
    backedBy: ["members", "forms", "reports", "roles", "facilities"],
  },
];

/**
 * The position terms — the category we would rather be measured in.
 *
 * "Church management software" makes a buyer compare our member list to
 * Breeze's member list. "Church operations platform" makes them ask who else
 * does training, facilities, meetings, media, forms, QR links and the books in
 * one login, and the answer is nobody in this field. These are the phrases the
 * hero and the <title> are built from.
 */
export const POSITION_TERMS: SeoTerm[] = [
  {
    primary: "church operations platform",
    tier: "position",
    variants: [
      "church operations software",
      "all-in-one church platform",
      "church management platform",
      "unified church software",
    ],
    question:
      "Is there one platform that runs everything a church does, not just the member list?",
    backedBy: [
      "members",
      "attendance",
      "giving",
      "finance",
      "training",
      "facilities",
      "meetings",
      "media",
      "forms",
      "comms",
      "events",
      "links",
    ],
  },
  {
    primary: "faith-based management platform",
    tier: "position",
    variants: [
      "faith-based operations platform",
      "ministry management software",
      "religious organisation management software",
      "faith organisation administration software",
    ],
    question:
      "What platform do faith-based organisations use to manage operations and administration?",
    backedBy: ["members", "groups", "branches", "roles", "finance", "reports"],
  },
  {
    primary: "multi-branch church software",
    tier: "position",
    variants: [
      "denomination management software",
      "church headquarters software",
      "multi-site church management",
      "church branch reporting software",
    ],
    question:
      "How can a denomination see every branch's attendance and giving in one place?",
    backedBy: ["branches", "reports", "analytics", "roles"],
  },
];

/**
 * Geographic terms, ordered by how winnable they are rather than by volume.
 *
 * `country` matches a key in `country-profile.ts`, so a page built from one of
 * these can state the real currency, the real timezone and whether SMS is
 * actually deliverable there — instead of the "localised" page that says
 * nothing a person could check. If a country is not in that table it does not
 * get a page.
 */
export type GeoTerm = SeoTerm & {
  tier: "geographic";
  /** Must exist in `PROFILES` in `country-profile.ts`. */
  country: string;
  /**
   * How people actually type the country, when that differs from its name.
   *
   * Nobody searches "church management software united kingdom" — they search
   * "uk". The keyword follows the search, and this field records the gap so
   * the test can still check the phrase and the country agree instead of the
   * assertion being loosened until it stops catching anything.
   */
  searchName?: string;
  /** Why a church here is underserved by the American incumbents. */
  localTruth: string;
  /** Who we are actually up against on this phrase. */
  incumbents?: string[];
};

export const GEO_TERMS: GeoTerm[] = [
  {
    primary: "church management software nigeria",
    tier: "geographic",
    country: "Nigeria",
    variants: [
      "church software nigeria",
      "church management system nigeria",
      "church app nigeria",
      "best church software in nigeria",
    ],
    question: "What is the best church management software for churches in Nigeria?",
    localTruth:
      "Prices and giving stay in Naira, SMS arrives from the church's own registered sender ID, and addresses use house, street, city, LGA and state.",
    backedBy: ["giving", "comms", "members", "finance"],
    incumbents: ["ChurchPlus", "ChurchHub", "Shepherd ChMS"],
  },
  {
    primary: "church management software kenya",
    tier: "geographic",
    country: "Kenya",
    variants: [
      "church software kenya",
      "church management system kenya",
      "church app kenya",
      "kanisa management system",
    ],
    question: "What church management software works for churches in Kenya?",
    localTruth:
      "Giving and finances are kept in Kenyan Shillings, the interface is available in Kiswahili, and reminders fire on Africa/Nairobi time.",
    backedBy: ["giving", "finance", "attendance"],
    incumbents: ["AdaKanisa", "GraceFlow", "ChurchCMS"],
  },
  {
    primary: "church management software ghana",
    tier: "geographic",
    country: "Ghana",
    variants: ["church software ghana", "church management system ghana", "church app ghana"],
    question: "Which church management software suits churches in Ghana?",
    localTruth:
      "Money is held in Ghana Cedis rather than converted, and the platform is built for mobile data rather than office broadband.",
    backedBy: ["giving", "finance", "members"],
    incumbents: ["Asoriba", "DaChurchMan", "Shepherd ChMS"],
  },
  {
    primary: "church management software uk",
    tier: "geographic",
    country: "United Kingdom",
    searchName: "uk",
    variants: [
      "church management software united kingdom",
      "uk church software",
      "church admin software uk",
      "church database uk",
    ],
    question: "What church management software can a UK church use?",
    localTruth:
      "Prices and giving in Pounds, dates and times on Europe/London, and a full export of your data whenever you ask for it.",
    backedBy: ["giving", "finance", "reports", "members"],
    incumbents: ["ChurchSuite", "iKnow Church", "ChurchDesk"],
  },
  {
    primary: "church management software south africa",
    tier: "geographic",
    country: "South Africa",
    variants: [
      "church software south africa",
      "church management system south africa",
      "kerk bestuur sagteware",
    ],
    question: "What church management software is available in South Africa?",
    localTruth:
      "Rand pricing, Africa/Johannesburg scheduling, and a platform that stays usable when the connection does not.",
    backedBy: ["giving", "finance", "attendance"],
    incumbents: ["Churches Software", "GoDoChurch", "IconCMO"],
  },
  {
    primary: "church management software uganda",
    tier: "geographic",
    country: "Uganda",
    variants: ["church software uganda", "church management system uganda"],
    question: "Is there church management software built for Ugandan churches?",
    localTruth:
      "Ugandan Shillings, Africa/Kampala time, and pricing set against a real congregation rather than an American one.",
    backedBy: ["giving", "attendance", "members"],
  },
];

/**
 * Use-case terms. One job each, and each one maps to a module that exists.
 *
 * These are the quiet workhorses. Volume is a fraction of the category term,
 * but the person searching "church attendance app" has already decided what
 * they need, and the page that answers exactly that converts several times
 * better than a page about everything.
 */
export const USE_CASE_TERMS: SeoTerm[] = [
  {
    primary: "church attendance app",
    tier: "useCase",
    variants: [
      "church attendance tracking software",
      "church attendance record app",
      "sunday service attendance app",
      "church headcount app",
      "attendance register for church",
    ],
    question: "How do I record church attendance on my phone every Sunday?",
    backedBy: ["attendance", "analytics", "branches"],
    incumbents: ["Planning Center Check-Ins", "Breeze ChMS"],
  },
  {
    primary: "church membership database",
    tier: "useCase",
    variants: [
      "church member directory software",
      "church membership management software",
      "church member records software",
      "church household directory",
    ],
    question: "What is the best way to keep a church membership database?",
    backedBy: ["members", "groups", "reports"],
  },
  {
    primary: "visitor follow-up software for churches",
    tier: "useCase",
    variants: [
      "church first-timer follow up",
      "church guest follow up software",
      "new visitor tracking church",
      "church assimilation software",
    ],
    question: "How can a church follow up first-time visitors without losing anyone?",
    backedBy: ["followup", "forms", "comms"],
  },
  {
    primary: "bulk sms for churches",
    tier: "useCase",
    variants: [
      "church sms software",
      "church text messaging service",
      "bulk sms church nigeria",
      "church sms sender id",
      "church mass texting",
    ],
    question: "How does a church send bulk SMS to all its members?",
    backedBy: ["comms", "reminders", "wallet"],
  },
  {
    primary: "church accounting software",
    tier: "useCase",
    variants: [
      "church finance software",
      "church bookkeeping software",
      "church treasurer software",
      "church income and expense tracking",
      "church fund accounting",
    ],
    question: "What software should a church treasurer use for the books?",
    backedBy: ["finance", "giving", "reports"],
  },
  {
    primary: "church giving and tithe software",
    tier: "useCase",
    variants: [
      "tithe and offering software",
      "church donation tracking software",
      "church pledge tracking",
      "building fund software church",
      "online giving for churches",
    ],
    question: "How can a church record tithes, offerings and pledges properly?",
    backedBy: ["giving", "finance", "payments"],
  },
  {
    primary: "church discipleship tracking software",
    tier: "useCase",
    variants: [
      "church training and classes software",
      "foundation school software",
      "church membership class tracking",
      "church course and certificate tracking",
    ],
    question:
      "How do we track who has completed baptism class, foundation school or leadership training?",
    backedBy: ["training", "members"],
  },
];

/**
 * Comparison terms. The highest-intent phrases on the internet, and the ones
 * most easily done dishonestly.
 *
 * `honestWeakness` is not optional and is not decoration. A comparison page
 * that only lists where we win is read as marketing by a person and discounted
 * by an assistant; one that says plainly what the other product does better is
 * the page that gets quoted. These sentences go on the page, verbatim.
 */
export type ComparisonTerm = SeoTerm & {
  tier: "comparison";
  /** The product being compared. Spelled as its own company spells it. */
  competitor: string;
  /** What we genuinely do better, in a sentence. */
  ourEdge: string;
  /** What they genuinely do better. Required. Goes on the page. */
  honestWeakness: string;
};

export const COMPARISON_TERMS: ComparisonTerm[] = [
  {
    primary: "churchsuite alternative",
    tier: "comparison",
    competitor: "ChurchSuite",
    variants: ["churchsuite competitors", "cheaper than churchsuite", "churchsuite vs"],
    question: "What is a good alternative to ChurchSuite?",
    ourEdge:
      "More of the job in one subscription — training, facilities, meetings, media and the books are included rather than scoped out — and it stays usable on a slow connection.",
    honestWeakness:
      "ChurchSuite has been serving UK churches since 2013, has a far longer list of integrations, and its rota and planning tools are more mature than ours.",
    backedBy: ["training", "facilities", "meetings", "finance"],
  },
  {
    primary: "planning center alternative",
    tier: "comparison",
    competitor: "Planning Center",
    variants: [
      "planning center competitors",
      "planning center alternative for africa",
      "cheaper alternative to planning center",
    ],
    question: "Is there an alternative to Planning Center that works outside the US?",
    ourEdge:
      "One price instead of nine separate modules, local currency and local SMS, and no assumption of office broadband.",
    honestWeakness:
      "Planning Center's service-planning and worship tools are the best in the category, its free People tier is genuinely free forever, and its mobile apps are more polished.",
    backedBy: ["comms", "giving", "finance"],
  },
  {
    primary: "breeze chms alternative",
    tier: "comparison",
    competitor: "Breeze ChMS",
    variants: ["breeze church management alternative", "breeze chms competitors"],
    question: "What can a church use instead of Breeze ChMS?",
    ourEdge:
      "Breeze is one flat US-dollar price whatever your size or country; we price in your own currency and include modules Breeze does not have at all.",
    honestWeakness:
      "Breeze is deliberately simpler, and simpler is a real feature — a volunteer learns it in an afternoon, and its support reputation is excellent.",
    backedBy: ["training", "facilities", "finance", "media"],
  },
  {
    primary: "free church management software",
    tier: "comparison",
    competitor: "free and open-source options",
    variants: [
      "free church software",
      "free church membership software",
      "church management software free trial",
      "no cost church software",
    ],
    question: "Is there free church management software, and what is the catch?",
    ourEdge:
      "Seven Sundays entirely free with no card, every feature on, and a full export of everything you entered if you decide to leave.",
    honestWeakness:
      "If your budget is genuinely zero for ever, ChMeetings' free tier up to 50 people, B1 Church, or self-hosting ChurchCMS are real answers and we are not.",
    backedBy: ["reports"],
  },
];

/**
 * Differentiator terms: small volume, almost no competition, and the person
 * searching them has already been let down by something else.
 *
 * Nobody types "offline church management software" idly. They type it because
 * their current software is unusable in their building. These pages do not need
 * to win a popularity contest — they need to exist, because when that search
 * happens there is currently no good answer anywhere, including ours.
 */
export const DIFFERENTIATOR_TERMS: SeoTerm[] = [
  {
    primary: "church software for slow internet",
    tier: "differentiator",
    variants: [
      "offline church management software",
      "low bandwidth church software",
      "church app that works offline",
      "lightweight church software",
    ],
    question: "Is there church software that still works on a slow or unreliable connection?",
    backedBy: ["attendance", "pwa"],
  },
  {
    primary: "multi-currency church software",
    tier: "differentiator",
    variants: [
      "church software in local currency",
      "church management software naira",
      "church software multiple countries",
      "international church management software",
    ],
    question: "Can church software keep our money in our own currency?",
    backedBy: ["giving", "finance", "payments"],
  },
  {
    primary: "church software with its own sms sender id",
    tier: "differentiator",
    variants: [
      "church sms from church name",
      "registered sms sender id church",
      "branded sms for churches",
    ],
    question: "Can SMS to our members arrive from our church's name instead of a number?",
    backedBy: ["comms"],
  },
  {
    primary: "church meeting software built in",
    tier: "differentiator",
    variants: [
      "church video meeting platform",
      "online church meeting software",
      "church zoom alternative",
      "church board meeting software",
    ],
    question: "Can we hold church meetings inside our church software instead of on Zoom?",
    backedBy: ["meetings"],
  },
  {
    primary: "church facilities booking software",
    tier: "differentiator",
    variants: [
      "church hall booking system",
      "church room booking software",
      "church venue scheduling",
    ],
    question: "How do we manage bookings for the church hall and rooms?",
    backedBy: ["facilities"],
  },
];

/** Everything, in one array, for the tests and the sitemap. */
export const ALL_TERMS: SeoTerm[] = [
  ...CATEGORY_TERMS,
  ...POSITION_TERMS,
  ...GEO_TERMS,
  ...USE_CASE_TERMS,
  ...COMPARISON_TERMS,
  ...DIFFERENTIATOR_TERMS,
];

/**
 * The entity sentence. One definition of what FlockInsight is, used verbatim
 * everywhere an assistant might quote it: `llms.txt`, the Organization and
 * SoftwareApplication schema, the meta description, and the summary paragraph
 * at the top of the landing page.
 *
 * It is one sentence on purpose. Entity consistency across a site correlates
 * strongly with being cited, and the cheapest way to be inconsistent is to let
 * four pages each describe the product in their own words.
 */
export const ENTITY_SENTENCE =
  "FlockInsight is an all-in-one church management and operations platform that handles attendance, members, groups, training, giving, church finances, visitor follow-up, communication, events, facilities, media and reporting in one login — built for churches, fellowships and ministries anywhere, and engineered in Nigeria for congregations on mobile data rather than office broadband.";

/**
 * The short form, for a <title>, an OG description, or anywhere with a budget
 * of about 160 characters.
 */
export const ENTITY_SENTENCE_SHORT =
  "All-in-one church management and operations: attendance, members, giving, finances, training, follow-up and communication in one login. Built for churches anywhere.";

/**
 * The site-wide `keywords` meta tag.
 *
 * Google stopped using this in 2009 and says so publicly. It is here for one
 * reason: AI crawlers building a page summary do still read it, and it is the
 * cheapest place to state the category, the position and the two largest
 * markets in a form a model can lift without parsing the layout.
 *
 * Deliberately short. A keyword tag with sixty phrases in it is a spam signal
 * to the systems that still read it at all, which is the opposite of the point.
 */
export function metaKeywords(): string[] {
  return [
    ...CATEGORY_TERMS.map((t) => t.primary),
    ...POSITION_TERMS.map((t) => t.primary),
    "church attendance app",
    "church membership database",
    "bulk sms for churches",
    "church accounting software",
    "church management software nigeria",
    "church management software kenya",
    "FlockInsight",
  ];
}

/** Terms that must never appear on the site, with the reason. */
export const FORBIDDEN_CLAIMS: { phrase: string; why: string }[] = [
  {
    phrase: "trusted by thousands",
    why: "We publish no church count. An unverifiable traction claim is the first thing a careful pastor checks and the fastest way to lose an AI assistant's trust.",
  },
  {
    phrase: "best church management software",
    why: "A self-awarded superlative. Say what it does; let a comparison page argue the case with named trade-offs.",
  },
  {
    phrase: "#1",
    why: "Same problem, with a number attached.",
  },
  {
    phrase: "AI-powered",
    why: "We do not ship a model-backed feature on the marketing pages. Claiming it to catch a search trend is the kind of thing that gets the rest of the page discounted.",
  },
  {
    phrase: "free forever",
    why: "It is seven Sundays free, then priced. ChMeetings and B1 are free forever; we are not, and the comparison page says so.",
  },
];
