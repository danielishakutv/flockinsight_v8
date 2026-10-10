import { fr as frContent } from "@/lib/landing-content-fr";
import { pt as ptContent } from "@/lib/landing-content-pt";

/**
 * Landing page copy, kept as data.
 *
 * Separated from the page for two reasons: the FAQ has to be rendered AND
 * emitted as FAQPage structured data, and duplicating it would guarantee the
 * two drift apart. And every claim here is checkable against the product —
 * this file is what search engines and AI assistants read to decide whether
 * the site is describing something real, so it says what FlockInsight does
 * rather than how many people supposedly use it.
 */

export type LandingFeature = {
  /** Icon key — mapped to a Lucide component on the page. */
  icon: string;
  title: string;
  body: string;
  /** Where to read more. Internal links help crawlers understand the site. */
  href?: string;
};

/**
 * Product facts, not usage numbers.
 *
 * Every one is verifiable by opening the app. Invented traction figures are
 * what search engines and AI assistants penalise, and they are the first thing
 * a careful pastor checks.
 */
/*
 * "₦0 to start" used to be the third of these, and it had to go.
 *
 * Not because it was untrue — there is no card to begin — but because a Naira
 * sign in the first figure a visitor reads tells a church in London, Nairobi
 * or Lisbon that this product is for somebody else. It is the same mistake the
 * old `<title>` made with "for Africa". The replacement says the same
 * reassuring thing in a way that is true everywhere: the money stays in your
 * money. 43 currencies in `lib/money.ts`, 62 countries profiled in
 * `lib/country-profile.ts` — "40+" is the figure we can defend if asked.
 */
export const HIGHLIGHTS: { value: string; label: string }[] = [
  { value: "18", label: "Modules, one login" },
  { value: "7", label: "Sundays free to try" },
  { value: "40+", label: "Currencies, yours included" },
  { value: "100%", label: "Your data, exportable" },
];

export const FEATURES: LandingFeature[] = [
  {
    icon: "attendance",
    title: "Attendance in under a minute",
    body: "Thumb the numbers in on your phone while you stand at the back — adults, teens, children and first-timers, split by gender if you want it. Recording the same service twice edits it rather than doubling it.",
  },
  {
    icon: "members",
    title: "Members & households",
    body: "One directory for the whole congregation, with families grouped under a household and children linked to a guardian. Import hundreds from a spreadsheet, or let members update their own details from a private link.",
  },
  {
    icon: "groups",
    title: "Groups, ministries & cells",
    body: "Choirs, ushers, departments, home cells and committees, each with its own leaders and titles. Message any of them without touching the rest of the church.",
  },
  {
    icon: "training",
    title: "Training & classes",
    body: "Run Foundation, Baptism, Pre-Marital and leadership training. Enrol people, record scores and grades, and a badge appears beside the names of everyone who completed it.",
  },
  {
    icon: "giving",
    title: "Giving, projects & pledges",
    body: "Record tithes and offerings under your own categories. Run a building fund with a target, track who pledged what, and chase only the people actually behind.",
  },
  {
    icon: "finance",
    title: "Finance — the whole books",
    body: "Income, expenses, bank accounts and transfers, with balances worked out rather than typed. Link a giving category to a fund and it fills itself from what people actually gave.",
  },
  {
    icon: "followup",
    title: "First-timer follow-up",
    body: "Visitors land in a list, get assigned to a real person, and move through stages until they join or say no. Automatic welcome messages do the first touch.",
  },
  {
    icon: "comms",
    title: "Bulk SMS & free email",
    body: "Reach everyone, one group, or a handful. Your own SMS sender ID so texts arrive from your church's name, and email that costs nothing however long it is.",
  },
  {
    icon: "reminders",
    title: "Reminders that send themselves",
    body: "Every service, every week, in your timezone, without anyone remembering. Birthdays and wedding anniversaries too, in your own words.",
  },
  {
    icon: "forms",
    title: "Forms with a shareable link",
    body: "Build a first-timer card or an event registration, share one link or a QR code, and have the answers create member records and drop into follow-up by themselves.",
  },
  {
    icon: "events",
    title: "Events & programmes",
    body: "Publish a crusade or convention with its flyer, dates and venue. Public events appear on your page and in the directory where people are looking for a church.",
  },
  {
    icon: "media",
    title: "Sermons & media library",
    body: "Upload sermons, photos, bulletins and documents, and share any of them with a link. Audio and video play in the browser — nobody has to download to listen.",
  },
  {
    icon: "devotionals",
    title: "Devotionals & newsletters",
    body: "Write a daily devotional or a weekly newsletter and email it to members and subscribers. Schedule a week ahead. Email is free and unlimited.",
  },
  {
    icon: "public",
    title: "Your own public page",
    body: "A real page at flockinsight.com/c/your-church, with service times and events kept current automatically because they come from your own records.",
  },
  {
    icon: "analytics",
    title: "Analytics & trends",
    body: "Growth over time, adults against children, one service against another, first-timers month by month. The shape, not just last Sunday's number.",
  },
  {
    icon: "reports",
    title: "Reports & full export",
    body: "Any part of your data as a spreadsheet or a PDF, or the whole thing in one file with a data dictionary. It is your church's data, and you can always take it.",
  },
  {
    icon: "branches",
    title: "Branches & denominations",
    body: "Link branches to a headquarters and see one report across all of them, grouped by zone. Each branch keeps its own records private — headquarters sees totals only.",
  },
  {
    icon: "roles",
    title: "Roles & permissions",
    body: "Let the ushering head record attendance without seeing giving, and the treasurer keep the books without opening the member directory. A section someone cannot open simply is not there.",
  },
];

/**
 * The engineering decisions, and why being built in Nigeria is the credential
 * rather than the limit.
 *
 * This list used to be headed "why this suits an African church specifically",
 * which quietly argued that a church anywhere else should look elsewhere. The
 * facts in it did not change — the frame did. Software that has to stay usable
 * on a congested mobile network in Lagos is software that is pleasant on
 * fibre in Rotterdam; the reverse is not true, which is why most church
 * software is unusable in half the world.
 *
 * Every line is a design decision you can verify in the product within an hour
 * of signing up. That is the only kind of claim worth publishing.
 */
export const BUILT_FOR: { title: string; body: string }[] = [
  {
    title: "Built where the connection is worst",
    body: "The pages a visitor or a volunteer actually opens are kept light, and nothing loads before you can read the page. Software that survives a congested mobile network is quick everywhere else by default.",
  },
  {
    title: "SMS that arrives from your church's name",
    body: "We handle the sender-ID registration with the networks for you, so your texts say GraceChapel rather than an unknown number people ignore.",
  },
  {
    title: "Your own money, not a conversion",
    body: "More than 40 currencies — Naira, Cedis, Shillings, Rand, Pounds, Euros, Dollars — recorded and reported as themselves. Your books are never somebody else's currency with a rate applied.",
  },
  {
    title: "Addresses the way your city writes them",
    body: "House, street, city, LGA and state where that is the format, ordinary postal addresses where it is not, and landmarks on your public page — because that is how people are really directed.",
  },
  {
    title: "Runs on the phone in your pocket",
    body: "Install it to your home screen and it opens like an app. Attendance is designed to be recorded standing up, one-handed, at the back of the hall.",
  },
  {
    title: "Priced against a real congregation",
    body: "Seven Sundays free, no card to begin, and a plan that starts small — in your currency, at your country's level, not converted from an American price list.",
  },
];

export const AUDIENCES = [
  "Local churches",
  "Campus & student fellowships",
  "House fellowships & cell groups",
  "Ministries & outreaches",
  "Multi-branch denominations",
];

export const PAINS = [
  "“I have no idea how many people actually came last Sunday — or last month.”",
  "“Our members’ details are scattered across notebooks, phones and three WhatsApp groups.”",
  "“First-timers visit once and we never follow up — they just disappear.”",
  "“Counting and tracking giving by hand takes hours and still doesn’t add up.”",
  "“We forget birthdays, and reminding everyone about service is a manual chore every week.”",
  "“Nobody can tell me who has finished Foundation Class without checking a notebook.”",
];

export const STEPS = [
  {
    n: 1,
    title: "Create your account",
    body: "Your church name, country and currency. About two minutes, no card.",
  },
  {
    n: 2,
    title: "Add services and members",
    body: "Set your Sunday and midweek services, then import your congregation from a spreadsheet.",
  },
  {
    n: 3,
    title: "Record your first Sunday",
    body: "Tap Record, count into the boxes, save. Your attendance chart starts from there.",
  },
];

/**
 * The questions people genuinely ask before signing up.
 *
 * Rendered on the page and emitted as FAQPage structured data, so a search
 * engine can show them directly and an assistant answering "what is
 * FlockInsight / does it do X" has a factual source to quote rather than
 * guessing from marketing copy.
 */
export const FAQ: { q: string; a: string }[] = [
  {
    q: "What is FlockInsight?",
    a: "FlockInsight is an all-in-one church management and operations platform. It holds attendance, members, groups, training, giving, church finances, visitor follow-up, communication, events, facilities, media and reports in one login, and gives every church a public page. It runs in a browser on any phone or computer.",
  },
  {
    q: "How much does it cost?",
    a: "Your first seven Sundays are free, with no card required. After that, plans differ mainly by how many members you can hold, and are charged in your own currency. Email to members is free and unlimited on every plan; SMS is paid per message from a wallet you top up.",
  },
  {
    q: "Does it work on a phone?",
    a: "Yes, and it is designed phone-first. You can install it to your home screen so it opens like an app. Recording attendance is built to be done one-handed while standing.",
  },
  {
    q: "Will it work on a slow internet connection?",
    a: "Yes. The public pages are kept deliberately light and the app avoids loading anything before you can read the page. It is built for churches on mobile data, not office fibre.",
  },
  {
    q: "Can I send SMS to my members?",
    a: "Yes. You apply once for a sender ID so texts arrive from your church's name rather than an unknown number, and we handle the registration with the networks. SMS is charged per message from your wallet. Email is free and unlimited.",
  },
  {
    q: "Can I move my existing records in?",
    a: "Yes. Members, attendance history and giving history can all be imported from a spreadsheet, so a church moving off Excel or a paper register starts with its history intact rather than from zero.",
  },
  {
    q: "Who can see what?",
    a: "You decide. Roles control access per module, so the ushering head can record attendance without seeing giving records, and the treasurer can keep the books without opening the member directory. A section someone lacks permission for does not appear for them at all.",
  },
  {
    q: "Can I get my data out?",
    a: "At any time. Every part of your records downloads as a spreadsheet or PDF, and a full export gives you the whole thing in one file with a data dictionary explaining how the files fit together. It is your church's data.",
  },
  {
    q: "Does it work for a denomination with several branches?",
    a: "Yes. Each branch runs as its own church with its own records and team, and can link to a headquarters that sees roll-up totals per branch, grouped into zones. Headquarters never sees an individual branch's member records or giving entries.",
  },
  {
    q: "Which countries does it work in?",
    a: "Any country with an internet connection. More than 60 countries are profiled with their own currency, timezone and address format, covering over 40 currencies including Naira, Cedis, Shillings, Rand, Pounds, Euros and Dollars. Churches use it across West and East Africa, Southern Africa and Europe. SMS sender IDs are currently Nigeria-only; email works everywhere.",
  },
  {
    q: "Is it only for African churches?",
    a: "No. It was engineered in Nigeria, which is why it stays usable on a poor connection and keeps your money in your own currency — both of which matter to a church anywhere. A church in London or Nairobi gets the same platform, priced and dated for where it actually is.",
  },
  {
    q: "Is my church's data safe?",
    a: "Each church's records are separate and only reachable by people you have invited. The database is backed up every day, encrypted, and copied off the server. Nobody at another church can see your members, your giving or your messages.",
  },
  {
    q: "Do I need to be technical to use it?",
    a: "No. If you can use WhatsApp you can use FlockInsight. Setting up a church takes about half an hour, and there are step-by-step guides for every part of it inside the app.",
  },
];

/* ============================================================
 * Languages
 * ========================================================== */

/**
 * The whole public site's copy, as one shape per language.
 *
 * Headings live here beside the data they head, rather than in the app's
 * dictionary. The landing page is one continuous argument — a section title,
 * its lead-in and its items are written together and have to be TRANSLATED
 * together, and splitting them across two systems is how a heading ends up in
 * French above a list still in English.
 *
 * The English below is assembled from the constants above so there is exactly
 * one copy of each sentence; `llms.txt` and the FAQ structured data keep
 * reading those constants directly.
 */
export type LandingContent = {
  hero: {
    eyebrow: string;
    title: string;
    /** The coloured tail of the headline, so it can move in translation. */
    titleAccent: string;
    body: string;
    ctaPrimary: string;
    ctaSecondary: string;
    reassurance: string;
  };
  highlights: { value: string; label: string }[];
  painsTitle: string;
  painsIntro: string;
  painsOutro: string;
  pains: string[];
  featuresTitle: string;
  features: LandingFeature[];
  stepsTitle: string;
  steps: { n: number; title: string; body: string }[];
  builtForTitle: string;
  builtFor: { title: string; body: string }[];
  audiencesTitle: string;
  audiences: string[];
  faqTitle: string;
  faq: { q: string; a: string }[];
  ctaTitle: string;
  ctaBody: string;
  footerTagline: string;
  pricing: PricingCopy;
  nav: NavCopy;
  footer: FooterCopy;
};

/**
 * The footer, and the two CTAs beside the hero.
 *
 * `privacy` and `terms` are the LINK text only. Those two documents stay in
 * English on purpose: they are binding, and an approximate translation of a
 * data-protection commitment misstates what the company has promised. That is
 * a decision for a lawyer, not a codemod.
 */
export type FooterCopy = {
  bookWalkthrough: string;
  loginToDashboard: string;
  product: string;
  company: string;
  legal: string;
  whatsNew: string;
  roadmap: string;
  blog: string;
  contact: string;
  privacy: string;
  terms: string;
};

/**
 * The public header. Short words, and every one of them a link somebody has to
 * recognise in their own language before they will click it.
 */
export type NavCopy = {
  features: string;
  howItWorks: string;
  pricing: string;
  faq: string;
  findChurch: string;
  bookDemo: string;
  logIn: string;
  startFree: string;
};

/**
 * The pricing section, on the landing page and on /pricing.
 *
 * Separate from the rest because the numbers inside it are not translated —
 * they are converted. A church in Maputo reads Portuguese around a price in
 * meticais, and the note explaining the card fee has to be as fluent as the
 * marketing copy or it reads as a catch.
 */
export type PricingCopy = {
  title: string;
  /** Deliberately says nothing about which currency: that depends on who is
   *  reading, and `currencyNote` answers it. */
  intro: string;
  promo: string;
  mostPopular: string;
  free: string;
  firstSundays: string;
  getStarted: string;
  contactUs: string;
  /** The "/mo" after a price. Moves in translation. */
  perMonth: string;
  customTitle: string;
  talkToUs: string;
  fullDetailsPre: string;
  pricingPageLink: string;
  /** Shown to a Nigerian visitor. */
  nairaNote: string;
  /**
   * Shown to everyone else. `{currency}` and `{fee}` are replaced at render;
   * a template rather than concatenation because the order of the two moves
   * between languages.
   */
  currencyNote: string;
  /** Replaces the last sentence of `currencyNote` when the rate is stale. */
  currencyNoteIndicative: string;
};

export const en: LandingContent = {
  /*
   * The headline is the positioning, so it is worth saying what changed.
   *
   * It used to end "in one simple app ... built for Africa". Two problems.
   * "App" invited a comparison with a member database, which is the fight we
   * lose — the field has ten of those and they are all older than us. And "for
   * Africa" is an instruction to every search engine and assistant to rule us
   * out for the churches we already have in London, Nairobi and Lisbon.
   *
   * "Run your whole church from one login" claims the operations category
   * instead, which nothing else in this field can claim, because nothing else
   * in this field is eighteen modules. Africa stays — as the engineering
   * credential further down the page, where it is an advantage rather than a
   * boundary.
   */
  hero: {
    eyebrow: "For churches, fellowships & ministries",
    title: "Run your whole church",
    titleAccent: "from one login",
    body: "Stop juggling notebooks, spreadsheets and WhatsApp groups. Attendance, members, groups, classes, giving, church finances and follow-up. Bulk SMS and free email, reminders that send themselves, events, facilities, forms, sermons and your own public page — eighteen modules, one login, in your own currency.",
    ctaPrimary: "Start my free trial",
    ctaSecondary: "See pricing",
    reassurance: "First 7 Sundays free • No card required • Cancel anytime",
  },
  highlights: HIGHLIGHTS,
  painsTitle: "The daily headaches of running a ministry",
  painsIntro:
    "If any of these feel like you, you're not alone — and it isn't your fault.",
  painsOutro: "FlockInsight fixes all of this — in one place. 👇",
  pains: PAINS,
  featuresTitle: "Everything you need to grow your ministry",
  features: FEATURES,
  stepsTitle: "Get started in minutes",
  steps: STEPS,
  builtForTitle: "Built in Nigeria, which is why it works anywhere",
  builtFor: BUILT_FOR,
  audiencesTitle: "Built for",
  audiences: AUDIENCES,
  faqTitle: "Straight answers",
  faq: FAQ,
  ctaTitle: "Start with this Sunday",
  ctaBody: "Seven Sundays free. No card required. Your data stays yours.",
  footerTagline:
    "Empowering churches with modern management tools to grow and thrive.",
  pricing: {
    title: "Simple pricing for every church",
    intro: "Start free and grow as your congregation grows. No card required to begin.",
    promo: "Launch promo: your first 7 Sundays are free",
    mostPopular: "Most popular",
    free: "Free",
    firstSundays: "First 7 Sundays",
    getStarted: "Get started",
    contactUs: "Contact us",
    perMonth: "/mo",
    customTitle:
      "Need something custom for a denomination or multi-branch ministry?",
    talkToUs: "Talk to us",
    fullDetailsPre: "See full plan details on the",
    pricingPageLink: "pricing page",
    nairaNote: "Prices in Naira.",
    currencyNote:
      "Prices shown in {currency}. Your card is charged in Nigerian Naira, and the total includes {fee} toward international card fees. Converted at today's exchange rate.",
    currencyNoteIndicative:
      "Prices shown in {currency}. Your card is charged in Nigerian Naira, and the total includes {fee} toward international card fees. The exchange rate service is unreachable right now, so the converted figure is indicative.",
  },
  nav: {
    features: "Features",
    howItWorks: "How It Works",
    pricing: "Pricing",
    faq: "FAQ",
    findChurch: "Find a church",
    bookDemo: "Book a demo",
    logIn: "Log in",
    startFree: "Start free",
  },
  footer: {
    bookWalkthrough: "Book a free walkthrough",
    loginToDashboard: "Login to Dashboard",
    product: "Product",
    company: "Company",
    legal: "Legal",
    whatsNew: "What's New",
    roadmap: "Roadmap",
    blog: "Blog",
    contact: "Contact",
    privacy: "Privacy Policy",
    terms: "Terms of Service",
  },
};

/**
 * The copy for one language, falling back to English.
 *
 * Synchronous and statically imported: this is a few kilobytes of text and the
 * landing page needs it while rendering, so there is nothing to gain from
 * deferring it and a flash of English to lose.
 */
export function landingContent(locale: string): LandingContent {
  if (locale === "fr") return frContent;
  if (locale === "pt") return ptContent;
  return en;
}
