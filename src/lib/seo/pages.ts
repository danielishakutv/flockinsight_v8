import {
  COMPARISON_TERMS,
  DIFFERENTIATOR_TERMS,
  GEO_TERMS,
  USE_CASE_TERMS,
  type ComparisonTerm,
  type GeoTerm,
  type SeoTerm,
} from "@/lib/seo/keywords";

/**
 * The pages built from the keyword map, and the content that makes each one
 * worth having.
 *
 * ## The thing this file is trying not to be
 *
 * A doorway page: the same paragraph with the city name swapped, times forty.
 * Search engines have penalised that pattern for fifteen years and AI
 * assistants discount it instantly, because the giveaway is obvious — nothing
 * on the page could only have been written about that one subject.
 *
 * So every entry below has to carry at least one fact that is true of *this*
 * term and of nothing else: the real currency and timezone a Kenyan church
 * gets, the specific competitor that already ranks in the UK, the actual
 * module that absorbs the job. Where there was nothing specific to say, the
 * page was not added. That is why there are twenty-two of these and not two
 * hundred, which the bulk-page tools would happily generate.
 *
 * ## URL shape
 *
 *   /church-management-software/nigeria   geographic
 *   /solutions/church-attendance-app      a single job, or a differentiator
 *   /compare/churchsuite-alternative      a named competitor
 *
 * Keyword-in-path is a weak ranking signal now, but these read well, they are
 * stable, and they keep out of the root namespace where the short share codes
 * live (/c, /p, /l, /s, /r, /f, /m, /n). A new marketing page must never be
 * able to shadow somebody's QR code.
 */

/* ============================================================
 * Slugs and paths
 * ========================================================== */

/** Lowercase, hyphenated, no stray punctuation. One implementation. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const GEO_BASE = "/church-management-software";
export const SOLUTION_BASE = "/solutions";
export const COMPARE_BASE = "/compare";

/** `Nigeria` -> `/church-management-software/nigeria` */
export function countrySlug(term: GeoTerm): string {
  return slugify(term.searchName ?? term.country);
}
export function countryPath(term: GeoTerm): string {
  return `${GEO_BASE}/${countrySlug(term)}`;
}

/** `church attendance app` -> `/solutions/church-attendance-app` */
export function solutionSlug(term: SeoTerm): string {
  return slugify(term.primary);
}
export function solutionPath(term: SeoTerm): string {
  return `${SOLUTION_BASE}/${solutionSlug(term)}`;
}

/** `churchsuite alternative` -> `/compare/churchsuite-alternative` */
export function compareSlug(term: ComparisonTerm): string {
  return slugify(term.primary);
}
export function comparePath(term: ComparisonTerm): string {
  return `${COMPARE_BASE}/${compareSlug(term)}`;
}

/** Every solution page: the single-job terms and the differentiators. */
export const SOLUTION_TERMS: SeoTerm[] = [
  ...USE_CASE_TERMS,
  ...DIFFERENTIATOR_TERMS,
];

/** Lookups for the dynamic routes. */
export function findCountry(slug: string): GeoTerm | undefined {
  return GEO_TERMS.find((t) => countrySlug(t) === slug);
}
export function findSolution(slug: string): SeoTerm | undefined {
  return SOLUTION_TERMS.find((t) => solutionSlug(t) === slug);
}
export function findComparison(slug: string): ComparisonTerm | undefined {
  return COMPARISON_TERMS.find((t) => compareSlug(t) === slug);
}

/** Every SEO page's path, for the sitemap and the footer. */
export function allSeoPaths(): string[] {
  return [
    ...GEO_TERMS.map(countryPath),
    ...SOLUTION_TERMS.map(solutionPath),
    ...COMPARISON_TERMS.map(comparePath),
  ];
}

/* ============================================================
 * Page content
 * ========================================================== */

/**
 * What goes on a page beyond what the keyword map already knows.
 *
 * `h1` is not the keyword with the first letter capitalised. "Church
 * Management Software Nigeria" as a headline is the sound of a page written for
 * a crawler, and a pastor bounces off it. The keyword belongs in the `<title>`
 * and in the body, where it reads naturally; the H1 is a sentence addressed to
 * a person.
 *
 * `summary` is the extractable paragraph directly under the H1. Content near
 * the top of a page is weighted heavily by the systems that build AI answers,
 * so this is written to be the answer to the term's `question` — in full
 * sentences, standing alone, quotable without the rest of the page.
 *
 * `points` are the specifics. Each one must be checkable in the product.
 *
 * `faq` is 3 to 4 questions, answers around 40 to 60 words. Not more: beyond
 * about six questions a page gains nothing in citations and starts to read as
 * padding.
 */
export type PageContent = {
  h1: string;
  summary: string;
  points: { title: string; body: string }[];
  faq: { q: string; a: string }[];
};

/**
 * Geographic pages.
 *
 * The honest problem with a country page is that most of the product is
 * identical everywhere. So each of these leads with the handful of things that
 * genuinely are not — the currency the books are kept in, the timezone the
 * reminders fire on, the interface language available, whether SMS actually
 * delivers — and then says plainly that the rest is the same. A page that
 * pretended to be a different product per country would be found out on day
 * one of the trial.
 */
export const GEO_CONTENT: Record<string, PageContent> = {
  Nigeria: {
    h1: "Church software built in Nigeria, for Nigerian churches",
    summary:
      "FlockInsight is church management software built in Nigeria. Attendance, members, groups, giving, church finances, first-timer follow-up, bulk SMS and training are in one login, with money kept in Naira, addresses written as house, street, city, LGA and state, and SMS arriving from your church's own registered sender ID. Your first seven Sundays are free, with no card required.",
    points: [
      {
        title: "Naira, start to finish",
        body: "Giving, expenses, bank accounts and every report are in Naira. Your plan is charged in Naira too — there is no conversion and no international card surcharge for a Nigerian church.",
      },
      {
        title: "SMS from your church's name",
        body: "We handle the sender-ID registration with MTN, Glo, Airtel and 9mobile for you, so a service reminder arrives from GraceChapel rather than an unknown number people have learned to ignore. SMS is charged per message from a wallet you top up.",
      },
      {
        title: "Addresses the way Nigeria writes them",
        body: "House number, street, city, LGA and state — plus a landmark field on your public page, because 'opposite the filling station after the second roundabout' is how people are actually directed.",
      },
      {
        title: "Hausa, Igbo, Yoruba and Pidgin",
        body: "The interface is available in all four alongside English. Nigerian Pidgin is included as a first-class option with its own ISO code, not as a joke setting.",
      },
      {
        title: "Built for the connection you actually have",
        body: "Pages stay light and nothing loads before you can read it, because the whole thing was written and tested on Nigerian mobile data rather than office fibre.",
      },
    ],
    faq: [
      {
        q: "Is FlockInsight a Nigerian company?",
        a: "Yes. It is built by Toko Technologies, a division of Toko Academy Ltd, in Nigeria. Support is in the same timezone as your church, and prices are set against a Nigerian congregation rather than converted from a dollar price list.",
      },
      {
        q: "Can members give online in Naira?",
        a: "Yes. A church connects its own payment gateway, so members can give by card, bank transfer or USSD and the money lands in the church's own account. FlockInsight does not sit between the giver and the church's bank.",
      },
      {
        q: "Do I need a sender ID before I can text members?",
        a: "You can start without one, but texts will come from a generic number. Applying takes a few days, we submit it to the networks for you, and once approved every message arrives from your church's name instead.",
      },
      {
        q: "What does it cost for a church of 200 members?",
        a: "Your first seven Sundays are entirely free with no card. After that, plans are tiered mainly by how many members you hold, and a congregation of 200 sits comfortably inside the mid plan. Current figures are on the pricing page in Naira.",
      },
    ],
  },
  Kenya: {
    h1: "Church management software for Kenyan churches",
    summary:
      "FlockInsight is an all-in-one church management platform used by churches in Kenya. Attendance, members, groups, giving, church finances, follow-up, training and events sit in one login, with every figure kept in Kenyan Shillings, reminders fired on Africa/Nairobi time and a Kiswahili interface alongside English. Your first seven Sundays are free, with no card required.",
    points: [
      {
        title: "Kenyan Shillings, not a conversion",
        body: "Offerings, expenses, bank accounts and every report are recorded and totalled in KES. Your books are never somebody else's currency with a rate applied over the top.",
      },
      {
        title: "Kiswahili, in the interface",
        body: "The whole platform is available in Kiswahili as well as English, so a volunteer recording attendance is not reading a second language to do it.",
      },
      {
        title: "Africa/Nairobi, everywhere it matters",
        body: "Service reminders, birthday greetings and scheduled devotionals all fire on your clock. A timezone set wrong moves every automatic message by hours, so the country profile sets it for you at signup.",
      },
      {
        title: "Built for mobile data",
        body: "Pages are deliberately light. Software engineered for a congested West African network is quick on a Kenyan one, and the difference is obvious against church software written for American office broadband.",
      },
      {
        title: "Email free, SMS not yet",
        body: "Email to members is free and unlimited on every plan. Our own SMS routes are Nigeria-only today, so a Kenyan church uses email and WhatsApp for broadcast rather than in-app SMS. We would rather say that here than have you find it on day three.",
      },
    ],
    faq: [
      {
        q: "Does FlockInsight support M-Pesa?",
        a: "Not directly today. A church connects its own payment gateway for online giving, and gifts received by M-Pesa are recorded in the giving module like any other method so the books and the member's giving history stay complete.",
      },
      {
        q: "Can I send bulk SMS to members in Kenya?",
        a: "Not through FlockInsight yet. SMS sender IDs and routes are Nigeria-only at present. Email to members is free and unlimited everywhere, and we list SMS coverage honestly rather than taking payment for messages we cannot deliver.",
      },
      {
        q: "Is my church's data stored safely?",
        a: "Each church's records are separate and reachable only by people you have invited. The database is backed up daily, encrypted, and copied off the server, and a full export of everything is available to you at any time.",
      },
      {
        q: "Will it work for a church with several branches?",
        a: "Yes. Each branch runs as its own church with its own records and team, and links to a headquarters that sees roll-up totals per branch grouped into zones. Headquarters never sees an individual branch's member records or giving entries.",
      },
    ],
  },
  Ghana: {
    h1: "Church management software for churches in Ghana",
    summary:
      "FlockInsight is an all-in-one church management and operations platform used by churches in Ghana. Attendance, members, groups, giving, church finances, follow-up, training, events and a public church page are in one login, with every figure kept in Ghana Cedis and the whole platform built to stay usable on mobile data. Your first seven Sundays are free, with no card required.",
    points: [
      {
        title: "Ghana Cedis throughout",
        body: "Offerings, expenses, bank balances and every report are in GHS. Pricing is converted into Cedis for you, with the international card fee shown as part of the figure rather than appearing at checkout.",
      },
      {
        title: "More than a member database",
        body: "Discipleship training with grades and badges, hall and room booking, staff video meetings, a media library and a forms builder are included — the parts of running a church that most church software leaves to other tools.",
      },
      {
        title: "Addresses and landmarks",
        body: "Your public page carries landmarks as well as an address, because that is how a first-time visitor is actually directed to a building in Accra or Kumasi.",
      },
      {
        title: "Priced for the congregation you have",
        body: "Seven Sundays free, no card to begin, and plans tiered by how many members you hold rather than by a feature list that keeps the useful parts out of reach.",
      },
    ],
    faq: [
      {
        q: "How does FlockInsight compare with Asoriba or DaChurchMan?",
        a: "Both are built for the West African market and know it well. FlockInsight's difference is breadth: eighteen modules in one login, including training, facilities, meetings and media. If you only need members and giving, a narrower tool may suit you better.",
      },
      {
        q: "Can members give online?",
        a: "Yes. A church connects its own payment gateway so gifts land in the church's own account. Offline giving — cash, cheque, transfer — is recorded in the same place, so a member's giving history is complete regardless of how they gave.",
      },
      {
        q: "Is bulk SMS available in Ghana?",
        a: "Not yet. Our SMS sender IDs and routes are Nigeria-only today. Email to members is free and unlimited on every plan everywhere, which covers most of what a church needs to broadcast.",
      },
    ],
  },
  "United Kingdom": {
    h1: "Church management software for UK churches",
    summary:
      "FlockInsight is an all-in-one church management and operations platform used by churches in the United Kingdom. Attendance, members and households, groups, giving and Gift-Aid-ready records, church finances, visitor follow-up, training, facilities booking and events are in one login, priced in Pounds and dated on Europe/London. Your first seven Sundays are free, with no card required.",
    points: [
      {
        title: "Pounds, and London time",
        body: "Giving, expenses and reports are kept in GBP, and every automatic message — service reminders, birthdays, scheduled devotionals — fires on Europe/London rather than drifting an hour twice a year.",
      },
      {
        title: "More included, for less than the UK incumbents",
        body: "ChurchSuite starts at £9/month for one module and under a hundred contacts; iKnow Church from £22/month under fifty adults. A FlockInsight plan includes the whole platform, training and facilities and meetings and media among it.",
      },
      {
        title: "Your data, exportable on demand",
        body: "Every part of your records downloads as a spreadsheet or PDF, and a full export gives you the whole database in one file with a data dictionary. No request, no waiting period, no retention of your records as leverage.",
      },
      {
        title: "Right for a diaspora congregation",
        body: "A church whose members are spread between two countries can keep the books in Pounds, run the interface in French, Portuguese, Swahili, Hausa, Igbo, Yoruba or Pidgin, and hold a second timezone in the calendar.",
      },
    ],
    faq: [
      {
        q: "Is it a real alternative to ChurchSuite?",
        a: "For breadth and price, yes — more of the job is in one subscription. ChurchSuite has served UK churches since 2013, has far more integrations, and its rota and planning tools are more mature than ours. We have written that comparison out in full.",
      },
      {
        q: "Does it handle Gift Aid?",
        a: "Giving records carry the detail a Gift Aid claim needs — donor, date, amount, fund — and export as a spreadsheet. There is no HMRC submission built in today, so the claim itself is still made through your usual route.",
      },
      {
        q: "Where is our data held, and can we get it out?",
        a: "Each church's records are isolated and reachable only by people you invite, backed up daily, encrypted and copied off-server. A full export with a data dictionary is available to you at any time, without asking us.",
      },
      {
        q: "Is this only for African churches?",
        a: "No. It was engineered in Nigeria, which is why it stays quick on a poor connection and keeps money in your own currency — both of which help a UK church too. Churches in Europe use it on the same platform, priced and dated for where they are.",
      },
    ],
  },
  "South Africa": {
    h1: "Church management software for South African churches",
    summary:
      "FlockInsight is an all-in-one church management and operations platform used by churches in South Africa. Attendance, members, groups, giving, church finances, visitor follow-up, training, facilities and events sit in one login, with every figure kept in Rand and reminders fired on Africa/Johannesburg time. Your first seven Sundays are free, with no card required.",
    points: [
      {
        title: "Rand, and Johannesburg time",
        body: "Offerings, expenses and reports are recorded in ZAR, and automatic messages fire on your own clock rather than an assumed one.",
      },
      {
        title: "Usable when the power and the line are not",
        body: "Pages are kept light and nothing loads before the page can be read. Software built to survive a congested mobile network is the software that still works on a phone during load-shedding.",
      },
      {
        title: "The whole operation, not a member list",
        body: "Hall and room booking, staff and committee video meetings, discipleship training with grades, a media library and a forms builder are included rather than being separate subscriptions.",
      },
      {
        title: "Roles that match how a church is actually run",
        body: "The ushering head can record attendance without seeing giving; the treasurer can keep the books without opening the member directory. A section somebody cannot open is not there for them at all.",
      },
    ],
    faq: [
      {
        q: "Can we take giving online in Rand?",
        a: "Yes. A church connects its own payment gateway so gifts arrive in the church's own account in ZAR, and offline giving is recorded alongside it so each member's history is complete.",
      },
      {
        q: "Is SMS available in South Africa?",
        a: "Not through FlockInsight yet — sender IDs and routes are Nigeria-only today. Email to members is free and unlimited on every plan, everywhere.",
      },
      {
        q: "How many languages does the interface support?",
        a: "Eight: English, French, Portuguese, Swahili, Hausa, Igbo, Yoruba and Nigerian Pidgin. Afrikaans and isiZulu are not available yet; English is the default for a South African church.",
      },
    ],
  },
  Uganda: {
    h1: "Church management software for Ugandan churches",
    summary:
      "FlockInsight is an all-in-one church management and operations platform for churches in Uganda. Attendance, members, groups, giving, church finances, follow-up, training and events are in one login, with every figure in Ugandan Shillings and reminders fired on Africa/Kampala time. Your first seven Sundays are free, with no card required.",
    points: [
      {
        title: "Ugandan Shillings",
        body: "Offerings, expenses and reports are recorded and totalled in UGX, with pricing converted into your own currency rather than quoted in dollars.",
      },
      {
        title: "Priced against a real congregation",
        body: "Seven Sundays free with no card, then plans tiered by how many members you hold. Nothing here assumes an American church budget.",
      },
      {
        title: "Attendance in under a minute",
        body: "Thumb the numbers in on your phone while standing at the back — adults, teens, children and first-timers. Recording the same service twice edits it rather than doubling it.",
      },
      {
        title: "First-timers get their own door",
        body: "Visitors are registered through a separate route from members, so they land in follow-up automatically and the membership count is not quietly overstated.",
      },
    ],
    faq: [
      {
        q: "Does it work on a slow connection?",
        a: "Yes, and that is a design constraint rather than a claim. The pages a volunteer actually opens are kept light, and nothing loads before the page can be read. It was built and tested on African mobile data.",
      },
      {
        q: "Is SMS available in Uganda?",
        a: "Not yet. Our sender IDs and routes are Nigeria-only today, so a Ugandan church uses email, which is free and unlimited on every plan, for broadcast.",
      },
      {
        q: "Can we import our existing records?",
        a: "Yes. Members, attendance history and giving history all import from a spreadsheet, so a church moving off Excel or a paper register starts with its history intact rather than from zero.",
      },
    ],
  },
};

/**
 * Solution pages: one job each.
 *
 * The buyer here has already decided what they need. They typed "church
 * attendance app", not "church software", which means the page's job is not to
 * sell the platform — it is to answer that one question completely and then
 * mention, once, that the rest exists.
 */
export const SOLUTION_CONTENT: Record<string, PageContent> = {
  "church attendance app": {
    h1: "Record church attendance from your phone, in under a minute",
    summary:
      "FlockInsight's attendance module lets you record a service on your phone while standing at the back of the hall: adults, teens, children and first-timers, split by gender if you want it, saved in under a minute. Recording the same service twice edits the existing entry rather than creating a duplicate. Every count feeds growth charts, branch comparisons and exportable reports automatically.",
    points: [
      {
        title: "One-handed, standing up",
        body: "The recording screen is built for a thumb at the back of a service, not a desk afterwards. Large number fields, no scrolling between them, one save.",
      },
      {
        title: "Bands, not just a total",
        body: "Adults, teens, children and first-timers as separate counts, optionally split by gender. A single headcount tells you nothing about whether your children's work is growing.",
      },
      {
        title: "Recording twice does not double it",
        body: "Entering the same service again opens the existing record to edit. The most common source of nonsense in a church attendance history is two people recording the same Sunday, and it simply cannot happen here.",
      },
      {
        title: "The shape, not just last Sunday",
        body: "Growth over time, adults against children, one service against another, first-timers month by month. The numbers become a trend without anybody building a spreadsheet.",
      },
      {
        title: "Branches roll up",
        body: "Each branch records its own attendance; headquarters sees every branch in one report, grouped into zones, without seeing any branch's member records.",
      },
    ],
    faq: [
      {
        q: "Does it work without internet?",
        a: "You need a connection to save, but the screen is deliberately light so it loads and submits on weak mobile data. Install it to your home screen and it opens like an app.",
      },
      {
        q: "Can I record attendance for a past Sunday?",
        a: "Yes. Pick the date and enter the counts. Churches moving over from a paper register usually backfill several months this way so their first chart is not empty.",
      },
      {
        q: "Can I track individual attendance, not just counts?",
        a: "Yes, alongside the counts. Counts are what a volunteer can realistically record in a minute; individual attendance matters for follow-up and for knowing who has quietly stopped coming.",
      },
      {
        q: "Who is allowed to record it?",
        a: "Whoever you give the role to. The ushering head can record attendance without being able to see giving records or the member directory — permissions are per module, and a section somebody lacks does not appear for them.",
      },
    ],
  },
  "church membership database": {
    h1: "A church membership database that stays current by itself",
    summary:
      "FlockInsight keeps one directory for your whole congregation, with families grouped under a household and children linked to a guardian. You can import hundreds of members from a spreadsheet, or send members a private link to update their own details so the directory corrects itself. Every other module — attendance, giving, follow-up, training, groups — reads from this one record.",
    points: [
      {
        title: "Households, not just rows",
        body: "Families group under a household and children link to a guardian, so you can see a family rather than six unconnected names, and message a household once instead of six times.",
      },
      {
        title: "Members update their own details",
        body: "A private link lets somebody correct their own phone number and address. This is the only thing that keeps a directory of two hundred people accurate, because nobody in the office knows when somebody moves.",
      },
      {
        title: "Import from the spreadsheet you already have",
        body: "Hundreds of members at once from a CSV or Excel file, with the columns mapped on screen. Attendance and giving history import the same way.",
      },
      {
        title: "First-timers have a separate door",
        body: "Visitors are registered through their own route so they are never filed as full members by accident — which would overstate your membership and hide them from follow-up at the same time.",
      },
      {
        title: "One record, read by everything",
        body: "Giving, attendance, training badges, group membership and follow-up all hang off the same person. There is no second list to keep in step.",
      },
    ],
    faq: [
      {
        q: "Can I control who sees member details?",
        a: "Yes. Access is per module, so a department leader can message their own group without opening the full directory, and the treasurer can keep the books without seeing member records at all.",
      },
      {
        q: "What happens to somebody who leaves?",
        a: "Their status changes; the record stays with its history. Deleting a person would take their giving history and attendance with them, which is usually the opposite of what a church wants.",
      },
      {
        q: "Can I export the directory?",
        a: "At any time, as a spreadsheet or PDF, or as part of a full export of the whole database with a data dictionary. It is your church's data and there is no request process.",
      },
    ],
  },
  "visitor follow-up software for churches": {
    h1: "Stop losing first-time visitors",
    summary:
      "FlockInsight registers first-time worshippers through their own route — not the membership form — so every visitor lands in a follow-up list, gets assigned to a real person, and moves through stages until they join or decline. An automatic welcome message does the first touch the same day. Nothing depends on somebody remembering to tick the right box.",
    points: [
      {
        title: "A separate door, on purpose",
        body: "Registering a visitor through the members form and missing one dropdown files them as a full member — and then follow-up never sees them, the welcome message never fires, and the membership count is wrong. So first-timers have their own page, and the function behind it takes no status argument at all.",
      },
      {
        title: "Assigned to a person, not a list",
        body: "Every visitor has a named owner and a stage. A visitor nobody owns is a visitor nobody calls.",
      },
      {
        title: "The first touch is automatic",
        body: "A welcome message goes out without anyone remembering. Email is free and unlimited; SMS arrives from your church's name where it is available.",
      },
      {
        title: "A public welcome card, safely",
        body: "Share a link or QR code at the door. It is off by default, rate-limited, honeypotted and never indexed, and it cannot set a status or claim to be an existing member — a public form that could overwrite member records would be a way to read them.",
      },
      {
        title: "Already a member? Nothing breaks",
        body: "A phone number or email already on the register never creates a second row, and an existing member's status is never changed by filling in a card. The reply is identical either way, so the form cannot be used to test whether somebody attends your church.",
      },
    ],
    faq: [
      {
        q: "What counts as a first-timer?",
        a: "Anyone registered through the first-timers route. They are saved with a visitor status and flagged for follow-up automatically, which is what makes them visible to the follow-up list and to the welcome messages.",
      },
      {
        q: "Can visitors register themselves?",
        a: "Yes, through a public welcome link or QR code you can turn on. It is rate-limited and never indexed by search engines, so a form meant for people in your building does not end up in front of strangers.",
      },
      {
        q: "What happens when a visitor becomes a member?",
        a: "You change their status, and their whole history — the date they first visited, who followed up, what was said — stays attached to the same record.",
      },
    ],
  },
  "bulk sms for churches": {
    h1: "Text your whole church, from your church's own name",
    summary:
      "FlockInsight sends bulk SMS to your whole congregation, one group, or a handful of people, arriving from your church's own registered sender ID rather than an unknown number. We handle the sender-ID registration with the networks for you. SMS is charged per message from a prepaid wallet; email to members is free and unlimited on every plan. SMS routes are currently Nigeria-only.",
    points: [
      {
        title: "Your name on the message",
        body: "A text from GraceChapel is read; a text from a five-digit shortcode is ignored. We submit the sender-ID registration to the networks on your behalf and tell you when it is approved.",
      },
      {
        title: "Anyone, or exactly the right people",
        body: "The whole church, one department, a single home cell, everyone with a birthday this week, or everyone behind on a pledge. The recipient list is built from the records you already keep.",
      },
      {
        title: "Charged per message, from a wallet",
        body: "You top up and spend it. No monthly SMS bundle to forecast, and the wallet is shared across the platform rather than being a separate account per feature.",
      },
      {
        title: "Out-of-window messages queue instead of vanishing",
        body: "Nigerian networks only deliver promotional traffic between 8am and 8pm — outside it a message is charged and dropped. So a send outside the window is queued until the window opens rather than taking your money for nothing.",
      },
      {
        title: "Email is free, and unlimited",
        body: "However long the message and however many members. For most of what a church needs to say, email is the right channel and the SMS wallet is for the things that must arrive.",
      },
    ],
    faq: [
      {
        q: "Which countries can you send SMS to?",
        a: "Nigeria today. Sender IDs and delivery routes are set up per country and we only list a country once we have confirmed real delivery to a real handset. Email works everywhere, free and unlimited.",
      },
      {
        q: "How long does a sender ID take to approve?",
        a: "Usually a few days, and the networks approve it, not us. You can send before it is approved, but messages will come from a generic number until it is.",
      },
      {
        q: "Can I see whether a message was delivered?",
        a: "Yes. Delivery reports come back per recipient, so a number that is switched off or no longer in service is visible rather than assumed delivered.",
      },
      {
        q: "Can I schedule a message?",
        a: "Yes. Any message can be scheduled, and recurring service reminders send themselves every week on your own timezone without anybody remembering. Birthday and wedding-anniversary greetings work the same way, in your own words rather than a template you cannot change.",
      },
    ],
  },
  "church accounting software": {
    h1: "The whole church books, not just the offering",
    summary:
      "FlockInsight's finance module holds income, expenses, bank accounts and transfers, with balances worked out rather than typed in. A giving category can be linked to a fund so it fills itself from what people actually gave. Every report — income and expenditure, fund balances, a single account's history — exports as a spreadsheet or a PDF, with correct currency symbols.",
    points: [
      {
        title: "Balances are calculated, never entered",
        body: "A typed balance is a balance that is wrong by next week. Accounts, transfers between them and every entry add up on their own.",
      },
      {
        title: "Giving flows into the books",
        body: "Link a giving category to a fund and the fund fills from what members actually gave, so the treasurer is not re-entering Sunday's offering into a second system.",
      },
      {
        title: "Separation of duties, enforced",
        body: "The treasurer can keep the books without opening the member directory, and whoever records giving need not see the bank accounts. Permissions are per module.",
      },
      {
        title: "PDFs with the right currency symbol",
        body: "Every money figure in every PDF draws correctly in Naira, Cedis, Shillings, Rand, Pounds or Euros. That sounds trivial and is not: the standard PDF fonts have no ₦ at all, so most tools silently print a broken bar instead.",
      },
      {
        title: "A full audit trail",
        body: "Every entry, edit and deletion is recorded with who did it and when, across every module — so a question about a figure has an answer rather than an argument.",
      },
    ],
    faq: [
      {
        q: "Is this double-entry accounting?",
        a: "It is fund-and-account bookkeeping rather than a full double-entry ledger: income, expenses, bank accounts, transfers and funds, with calculated balances. It is built for a church treasurer, not for a chartered accountant's trial balance.",
      },
      {
        q: "Can I keep more than one bank account?",
        a: "Yes, as many as the church actually has, with transfers recorded between them and each account's running balance derived from its own entries rather than typed in. A transfer appears once as a movement, not twice as an expense and an income, which is the usual way a spreadsheet overstates both.",
      },
      {
        q: "Can an auditor get what they need?",
        a: "Yes. Any report exports as a spreadsheet or PDF, a full export gives the whole database with a data dictionary, and the audit trail shows every change with the person who made it.",
      },
    ],
  },
  "church giving and tithe software": {
    h1: "Record tithes, offerings, pledges and projects properly",
    summary:
      "FlockInsight records tithes and offerings under your own categories, runs building funds and projects with targets, and tracks who pledged what so you can follow up only the people actually behind. Members can give online by card, bank transfer or USSD into the church's own account, and cash or transfer gifts are recorded alongside so every member's giving history is complete.",
    points: [
      {
        title: "Your categories, not ours",
        body: "Tithe, offering, seed, building fund, welfare, missions — named the way your church names them, and reported the same way.",
      },
      {
        title: "Projects with a target",
        body: "Run a building fund with a goal, see what has come in against it, and share a link that shows the progress. The link works for people who are not members of your church at all.",
      },
      {
        title: "Chase only who is behind",
        body: "Pledges are tracked against what was actually given, so a reminder goes to the people genuinely outstanding rather than to everybody who ever pledged.",
      },
      {
        title: "Online giving into your own account",
        body: "You connect your own payment gateway. The money goes from the giver to the church's bank; FlockInsight never holds it.",
      },
      {
        title: "Names can come off without the figures",
        body: "A collection can be shared with the amounts visible and the givers anonymous, which is the normal way a department reports what it raised.",
      },
    ],
    faq: [
      {
        q: "Can we take giving online?",
        a: "Yes, by connecting your own payment gateway, so gifts land in the church's own account. Card, bank transfer and USSD are supported depending on your gateway and country.",
      },
      {
        q: "Does a giver get a receipt?",
        a: "Yes, automatically, by email as soon as the gift is recorded, and the church keeps its own copy of every receipt issued. Receipts are retained so a giver who needs one again at the end of the year does not have to ask somebody to search a bank statement for them.",
      },
      {
        q: "Can people give without being members?",
        a: "Yes. A public giving link or a group collection link accepts gifts from anyone, and a contributor who is not on the member register is recorded as a contributor rather than silently added to your membership.",
      },
      {
        q: "Can we see a member's whole giving history?",
        a: "Yes — online and offline giving together, in one place, exportable as a spreadsheet or PDF. Permissions control who in the church is allowed to look, so the treasurer can keep the books without the member directory and a department head can see neither.",
      },
    ],
  },
  "church discipleship tracking software": {
    h1: "Know who has finished Foundation Class without opening a notebook",
    summary:
      "FlockInsight runs church training as real courses: Foundation School, baptism class, pre-marital counselling, leadership and workers' training. You create a course, enrol people into a cohort, record scores and grades, and a badge appears beside the name of everyone who completed it — visible wherever that member appears in the platform.",
    points: [
      {
        title: "Courses and cohorts",
        body: "A course runs more than once. Each intake is its own cohort with its own enrolments, dates and results, so last year's class does not blur into this year's.",
      },
      {
        title: "Scores and grades, recorded",
        body: "Not just attended or not. Marks and grades per person, so completion means something and a certificate can be defended.",
      },
      {
        title: "A badge beside the name",
        body: "Completion shows up next to that member everywhere in the app. The question 'has this person done Foundation School?' stops requiring a search.",
      },
      {
        title: "The answer to who is eligible",
        body: "Workers' lists, baptism lists and leadership appointments all turn on who has completed what. With the records in one place that is a filter rather than an afternoon.",
      },
    ],
    faq: [
      {
        q: "Can I run the same class every year?",
        a: "Yes. One course, a new cohort per intake, each with its own enrolments and results. The course definition stays; the history accumulates.",
      },
      {
        q: "Can a member see their own progress?",
        a: "Members with an app login can see the courses and badges attached to them. A member without a login still has the record kept against their name.",
      },
      {
        q: "Can I issue certificates?",
        a: "Results and completion records export as a spreadsheet or PDF, with correct currency and character rendering, which is what most churches use to produce certificates.",
      },
    ],
  },
  "church software for slow internet": {
    h1: "Church software that still works when the connection does not",
    summary:
      "FlockInsight is built to stay usable on a weak mobile connection. The pages a volunteer or a visitor actually opens are kept deliberately light, nothing loads before the page can be read, and it installs to a phone's home screen so it opens like an app. This is a design constraint rather than a feature: it was written and tested on African mobile data, not office broadband.",
    points: [
      {
        title: "Nothing loads before you can read",
        body: "The marketing and public pages carry no toast library, no second font and no analytics-first bootstrap. One font family, not two — the monospace face was removed because it cost a second of page budget for six snippets almost nobody sees.",
      },
      {
        title: "Light where it counts",
        body: "The screens opened most often by volunteers — attendance, member lookup, a church's public page — are the ones kept lightest, rather than the dashboard that looks best in a screenshot.",
      },
      {
        title: "Installs like an app",
        body: "Add it to your home screen and it opens full-screen from an icon, with its own offline page rather than a browser error when the signal drops.",
      },
      {
        title: "Built where the connection is worst",
        body: "Software that survives a congested Lagos network is quick on fibre in Rotterdam. The reverse is not true, which is why most church software is effectively unusable in half the world.",
      },
    ],
    faq: [
      {
        q: "Can I use it fully offline?",
        a: "Not fully — saving a record needs a connection. What it does is stay usable on a bad one: light pages, no heavy preloading, an installed app shell, and a proper offline page instead of a browser error.",
      },
      {
        q: "Does it work on an older Android phone?",
        a: "Yes. It runs in the browser, so there is no app store download and no minimum OS version to chase. Install-to-home-screen works on both Android and iOS.",
      },
      {
        q: "How much data does it use?",
        a: "Far less than a typical church platform, because the pages volunteers open are kept deliberately small. There is no video or large imagery on the paths used weekly.",
      },
    ],
  },
  "multi-currency church software": {
    h1: "Keep your church's money in your own currency",
    summary:
      "FlockInsight records and reports every figure in your church's own currency. Forty-one currencies are supported and sixty-one countries are profiled with their own currency, timezone and address format, so a church in Lagos keeps Naira, one in Nairobi keeps Shillings, and one in London keeps Pounds. Nothing is converted into somebody else's money and converted back for a report.",
    points: [
      {
        title: "41 currencies, recorded as themselves",
        body: "Naira, Cedis, Shillings, Rand, Kwacha, Pounds, Euros, Dollars and more. Your books are your money, not a conversion with a rate applied over the top.",
      },
      {
        title: "61 country profiles",
        body: "Each sets the currency, the timezone, the dial code and the address format at signup. A timezone set wrong moves every automatic reminder by hours, so it is not left to a dropdown nobody reads.",
      },
      {
        title: "Correct symbols in every PDF",
        body: "The standard PDF fonts are a 256-character set with no ₦ and no ₵ in them, which is why most church software prints a broken bar where the Naira sign belongs. Ours embeds a font that carries them, and a test reads the font files to prove it.",
      },
      {
        title: "Pricing in your money, with the fee shown",
        body: "Plan prices convert into your currency, and where an international card fee applies it is included in the figure you are shown rather than appearing at checkout.",
      },
    ],
    faq: [
      {
        q: "Can one church hold two currencies?",
        a: "A church's books are kept in one currency — its own. A denomination with branches in different countries gives each branch its own church with its own currency, and headquarters sees each branch's totals.",
      },
      {
        q: "What if my country is not listed?",
        a: "It still works. An unprofiled country falls back to US Dollars and UTC rather than being quietly filed under West Africa, so the default is wrong in a way you will notice immediately and can correct in settings.",
      },
      {
        q: "Are exchange rates applied to our records?",
        a: "No. Your records are in your currency, full stop. Conversion only happens when displaying a plan price, and the rate used is today's.",
      },
    ],
  },
  "church software with its own sms sender id": {
    h1: "Make your texts arrive from your church's name",
    summary:
      "FlockInsight registers an SMS sender ID with the mobile networks on your church's behalf, so a service reminder arrives from GraceChapel rather than an unknown five-digit number. We submit the application, track its approval and tell you when it is live. SMS is charged per message from a prepaid wallet. Sender IDs are currently available in Nigeria.",
    points: [
      {
        title: "We do the registration",
        body: "Network sender-ID registration is paperwork, and it is the step that stops most churches ever getting a branded SMS. We submit it for you and follow it up.",
      },
      {
        title: "Approval is reconciled from the network",
        body: "The status shown is the status the network reports, not a flag somebody set in our database and forgot. A sender ID that was rejected does not sit in the app looking approved.",
      },
      {
        title: "Messages queue rather than disappear",
        body: "Nigerian networks only deliver this traffic between 8am and 8pm; outside that a message is charged and dropped. A send outside the window is held until it opens instead of taking your money for nothing.",
      },
      {
        title: "Delivery reported per recipient",
        body: "You see which numbers received the message and which did not, so a dead number is visible rather than assumed fine.",
      },
    ],
    faq: [
      {
        q: "How long does approval take?",
        a: "Usually a few days. The networks decide, not us. You can send in the meantime and messages will come from a generic number until the ID is live.",
      },
      {
        q: "Which countries is this available in?",
        a: "Nigeria today. We only list a country once we have confirmed real delivery to a real handset, because an SMS button that charges and does not deliver is worse than no SMS button.",
      },
      {
        q: "Can two churches share a sender ID?",
        a: "No. A sender ID belongs to the church that registered it, and every send is checked against who owns it — otherwise one church could text from another church's name.",
      },
    ],
  },
  "church meeting software built in": {
    h1: "Hold church meetings inside your church software",
    summary:
      "FlockInsight includes video meetings, so a workers' meeting, a committee or a board sits inside the same platform that holds the records being discussed. No separate Zoom subscription, no link to circulate, and the attendance and decisions are recorded against the church rather than in somebody's personal account.",
    points: [
      {
        title: "No second subscription",
        body: "Meetings are part of the platform rather than a separate monthly bill, which for most churches is the whole reason a committee meets on a personal Zoom account instead.",
      },
      {
        title: "A room can be a service",
        body: "Meetings can be set up as a recurring series, one row per week, so a weekly workers' meeting has a stable place rather than a new link each time. Old codes redirect forward to the current one.",
      },
      {
        title: "Built for the bandwidth you have",
        body: "Audio is negotiated per peer and given its own budget, so a participant on poor mobile data stays audible rather than taking the whole call down.",
      },
      {
        title: "Recorded against the church",
        body: "Who was in the room and what was decided belongs in the church's own audit trail, not in the meeting history of whoever happened to own the account.",
      },
    ],
    faq: [
      {
        q: "How many people can join a meeting?",
        a: "It is built for the size a church committee actually is — a workers' meeting or a board, not a conference. For a congregation-wide broadcast, a streaming platform is the right tool and we do not pretend otherwise.",
      },
      {
        q: "Do participants need an account?",
        a: "People you invite from your church join signed in. A guest can join with a link and a code without creating an account.",
      },
      {
        q: "Which plan includes meetings?",
        a: "Meetings are available on paid plans, and recurring meeting series are a Pro feature. Current plan contents are listed in full on the pricing page, and a write that is off-plan is refused with an explanation rather than failing silently somewhere you will not see it.",
      },
    ],
  },
  "church facilities booking software": {
    h1: "Stop double-booking the church hall",
    summary:
      "FlockInsight's facilities module holds your halls and rooms, their bookings and their closures, so a wedding and a youth programme cannot be given the same Saturday. Bookings sit beside the events, services and meetings already in the platform rather than in a diary in the church office that nobody outside it can see.",
    points: [
      {
        title: "Rooms, bookings and closures",
        body: "A closure is as important as a booking: a hall being repainted is not available, and the only way that fact reaches whoever takes the next request is if it lives in the same place.",
      },
      {
        title: "Beside everything else on the calendar",
        body: "Services, events and meetings are already in the platform. A booking system that cannot see them is the reason the double-booking happened.",
      },
      {
        title: "Whoever takes requests can see it",
        body: "Permissions are per module, so the person who answers the phone can check and record a booking without being given access to giving or the member directory.",
      },
    ],
    faq: [
      {
        q: "Can we charge for a booking?",
        a: "A booking records what was agreed, and any payment is recorded in finance against the right fund. There is no automated invoicing of hall hire today.",
      },
      {
        q: "Can members request a room themselves?",
        a: "Bookings are made by staff with the facilities role. A member request comes in through a form, which drops into the same platform for somebody to action.",
      },
      {
        q: "Is this available on every plan?",
        a: "Module availability by plan is listed in full on the pricing page, and a write that is off-plan is refused with an explanation rather than failing silently.",
      },
    ],
  },
};

/**
 * Comparison pages.
 *
 * `ourEdge` and `honestWeakness` already live on the term in the keyword map
 * and are rendered on both the landing page and here, so they are not repeated
 * in this content. What these add is the part a comparison page is actually
 * read for: who should pick the other one.
 */
export type CompareContent = PageContent & {
  /** Who we would genuinely send to the competitor. Required, and it is the point. */
  chooseThemIf: string[];
  /** Who we think we are the better answer for. */
  chooseUsIf: string[];
};

export const COMPARE_CONTENT: Record<string, CompareContent> = {
  ChurchSuite: {
    h1: "Looking for a ChurchSuite alternative?",
    summary:
      "ChurchSuite is the incumbent for UK churches and a genuinely good product. FlockInsight is a broader platform for less money: eighteen modules in one subscription, including discipleship training, facilities booking, video meetings and a media library, priced in your own currency and built to stay usable on a poor connection. ChurchSuite has a decade more integrations and more mature rota and planning tools.",
    chooseThemIf: [
      "You need a long list of third-party integrations, or a specific UK one.",
      "Rota and service planning is the centre of how you run Sundays.",
      "You want the product most UK church administrators already know how to use.",
    ],
    chooseUsIf: [
      "You are paying for ChurchSuite plus Zoom plus a forms tool plus a bulk-SMS site, and want one bill.",
      "You run discipleship courses, book halls, or hold committee meetings and want those inside the same platform.",
      "Your congregation is spread across countries or currencies.",
      "Your volunteers are on mobile data rather than office broadband.",
    ],
    points: [
      {
        title: "Modules are not add-ons",
        body: "ChurchSuite's entry price covers one module and fewer than a hundred contacts. A FlockInsight paid plan includes the platform — training, facilities, meetings, media, forms and the books among it.",
      },
      {
        title: "Your currency, your clock",
        body: "Sixty-one country profiles, forty-one currencies, and every automatic message fired on your own timezone.",
      },
      {
        title: "Your data out, on demand",
        body: "Full export with a data dictionary, at any time, without a request process.",
      },
    ],
    faq: [
      {
        q: "Can I move my ChurchSuite data across?",
        a: "Members, attendance history and giving history import from a spreadsheet, and ChurchSuite exports those. Plan on a weekend for a church of a few hundred, and keep your export file until you have checked the totals.",
      },
      {
        q: "Is FlockInsight cheaper than ChurchSuite?",
        a: "For most churches, yes, and more so once you count the tools it replaces. But compare the plan you would actually need rather than the entry prices — ChurchSuite's £9 tier is one module under a hundred contacts.",
      },
      {
        q: "Is ChurchSuite better at anything?",
        a: "Yes. It has served UK churches since 2013, has far more integrations, and its rota and service-planning tools are more mature than ours. If those are the centre of your week, it is the better product for you.",
      },
    ],
  },
  "Planning Center": {
    h1: "A Planning Center alternative that works outside the United States",
    summary:
      "Planning Center is the strongest service-planning product in the category and its People tier is free forever. FlockInsight is the better fit for a church outside the US: one price instead of nine separately-billed modules, money kept in your own currency, SMS from your own registered sender ID, and pages built for mobile data. Planning Center's worship tools and mobile apps are better than ours.",
    chooseThemIf: [
      "Worship and service planning is the centre of your Sundays — theirs is the best there is.",
      "Your budget is genuinely zero and the free People tier is enough.",
      "You are a US church and dollar pricing and US payment rails are what you want.",
    ],
    chooseUsIf: [
      "You are outside the US and tired of paying in dollars and reporting in your own currency.",
      "Nine separate module subscriptions have become hard to predict or justify.",
      "You need discipleship training records, facilities booking or committee meetings.",
      "Your volunteers open the app on mobile data.",
    ],
    points: [
      {
        title: "One plan, not nine line items",
        body: "Planning Center prices People, Giving, Groups, Check-Ins, Registrations, Services, Music Stand, Publishing and Calendar separately. One FlockInsight plan is one figure.",
      },
      {
        title: "Local money and local SMS",
        body: "Books in your currency, and texts from your church's own name where sender IDs are available.",
      },
      {
        title: "Built for a worse connection than theirs assumes",
        body: "Pages are kept light deliberately, because the volunteer recording attendance is standing in a hall on mobile data.",
      },
    ],
    faq: [
      {
        q: "Is Planning Center really free?",
        a: "The People module genuinely is, with no time limit — that is a real offer and we will not pretend otherwise. The cost arrives when you add Giving, Check-Ins, Groups or Services, each priced separately.",
      },
      {
        q: "What does Planning Center do better?",
        a: "Service and worship planning, by a distance, plus more polished mobile apps and a free-forever People tier. If your church's week revolves around planning services and rotas, that is the product to buy.",
      },
      {
        q: "Can I import from Planning Center?",
        a: "Yes. Planning Center exports members, attendance and giving as spreadsheets, and all three import here with the columns mapped on screen.",
      },
    ],
  },
  "Breeze ChMS": {
    h1: "A Breeze ChMS alternative for churches outside the US",
    summary:
      "Breeze is deliberately simple, one flat price, unlimited users, and has an excellent support reputation. FlockInsight costs less for most churches outside the US because it is priced in local currency rather than one flat dollar figure, and it includes modules Breeze does not have at all — discipleship training, facilities booking, video meetings, a media library and a forms builder. Breeze is easier to learn.",
    chooseThemIf: [
      "You want the simplest possible tool and will not use a broader platform.",
      "You are a US church, where one flat dollar price is straightforward rather than punishing.",
      "Hand-holding support during setup matters more than feature breadth.",
    ],
    chooseUsIf: [
      "A flat US-dollar price is expensive relative to what your congregation can give.",
      "You want training records, facilities, meetings or media in the same place.",
      "You need your books in your own currency and your reminders on your own clock.",
      "You have multiple branches reporting to a headquarters.",
    ],
    points: [
      {
        title: "Priced where you are",
        body: "Breeze is one flat price whatever your size or country. FlockInsight prices in your own currency and tiers by how many members you hold.",
      },
      {
        title: "Modules Breeze does not have",
        body: "Discipleship training with grades and badges, hall and room booking, video meetings, a media library, a forms builder, QR links and public link pages.",
      },
      {
        title: "Multi-branch reporting",
        body: "Branches keep their own records private and roll totals up to a headquarters by zone.",
      },
    ],
    faq: [
      {
        q: "Is Breeze simpler than FlockInsight?",
        a: "Yes, and that is a genuine feature rather than a limitation. A volunteer learns Breeze in an afternoon. FlockInsight does more, and doing more always costs something in learning time.",
      },
      {
        q: "How do the prices compare?",
        a: "Breeze is a single flat monthly figure in US dollars. Whether FlockInsight is cheaper depends on your currency and size — compare the actual plan you need, in your own money, on the pricing page.",
      },
      {
        q: "Can I import from Breeze?",
        a: "Yes. Breeze exports people, giving and attendance as spreadsheets, and all three import here with the columns mapped on screen. Keep the export file until you have checked the totals match — that is the one step churches skip and then regret.",
      },
    ],
  },
  "free and open-source options": {
    h1: "Is there genuinely free church management software?",
    summary:
      "Yes, and FlockInsight is not it. ChMeetings has a free tier up to fifty people, B1 Church is free and built by a nonprofit, and ChurchCMS is open source and free if you can host it. FlockInsight gives every church seven Sundays entirely free with no card and every feature switched on, then charges — and gives you a full export of everything you entered if you decide to leave.",
    chooseThemIf: [
      "Your budget is genuinely zero for the long term, not just to start.",
      "You are under fifty people and ChMeetings' free tier covers you.",
      "You can host and maintain software yourself, which makes ChurchCMS a real option.",
    ],
    chooseUsIf: [
      "You want every feature during the trial rather than a reduced free tier.",
      "You would rather pay a small amount than be the IT department.",
      "You need local currency, local SMS and support in your timezone.",
    ],
    points: [
      {
        title: "Seven Sundays, everything on",
        body: "Not a limited tier. The whole platform, no card required, so the trial tells you what the product actually is.",
      },
      {
        title: "Leaving is not punished",
        body: "A full export of your entire database with a data dictionary, at any time. The usual cost of free software is the difficulty of getting your data out of it; the usual cost of paid software is the same thing.",
      },
      {
        title: "What 'free' usually costs",
        body: "A member cap, a transaction fee on giving, your own hosting and upgrades, or no support. None of those are dishonest — they are just the price, paid somewhere other than a subscription.",
      },
    ],
    faq: [
      {
        q: "What happens at the end of the seven Sundays?",
        a: "You pick a plan, or you stop. Nothing is deleted the moment the trial ends, and your export is available either way. We also remind you before it ends rather than letting it lapse quietly.",
      },
      {
        q: "Is there a free plan after the trial?",
        a: "No. Plans start small and are priced in your own currency, but there is no permanently free tier. If that is what you need, ChMeetings or B1 Church are the honest answer and we would rather say so.",
      },
      {
        q: "Do you take a cut of our giving?",
        a: "No. You connect your own payment gateway and the money goes from the giver to your church's bank account. Your gateway's fees are between you and them.",
      },
    ],
  },
};

/* ============================================================
 * Resolution
 * ========================================================== */

export function geoContent(term: GeoTerm): PageContent | undefined {
  return GEO_CONTENT[term.country];
}
export function solutionContent(term: SeoTerm): PageContent | undefined {
  return SOLUTION_CONTENT[term.primary];
}
export function compareContent(term: ComparisonTerm): CompareContent | undefined {
  return COMPARE_CONTENT[term.competitor];
}
