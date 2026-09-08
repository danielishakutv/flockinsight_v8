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
export const HIGHLIGHTS: { value: string; label: string }[] = [
  { value: "18", label: "Modules, one login" },
  { value: "7", label: "Sundays free to try" },
  { value: "₦0", label: "To start — no card" },
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
 * Why this suits an African church specifically. These are design decisions
 * you can verify in the product, which is what makes them worth publishing.
 */
export const BUILT_FOR: { title: string; body: string }[] = [
  {
    title: "It works on a slow connection",
    body: "The pages a visitor or a volunteer actually opens are built to be light. No heavy dashboards where a simple page will do, and nothing loaded before you can read the page.",
  },
  {
    title: "SMS that arrives from your church's name",
    body: "We handle the sender-ID registration with the networks for you, so your texts say GraceChapel rather than an unknown number people ignore.",
  },
  {
    title: "Naira, and 30 other African currencies",
    body: "Money is recorded and reported in your own currency, not converted into somebody else's.",
  },
  {
    title: "Addresses the way they are actually written",
    body: "House, street, city, LGA and state — with landmarks on your public page, because that is how people are really directed in a Nigerian city.",
  },
  {
    title: "Runs on the phone in your pocket",
    body: "Install it to your home screen and it opens like an app. Attendance is designed to be recorded standing up, one-handed.",
  },
  {
    title: "Priced for a real congregation",
    body: "Seven Sundays free, no card to begin, and a plan that starts small. Nothing here assumes an American church budget.",
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
    a: "FlockInsight is church management software for churches, fellowships and ministries. It keeps attendance, members, groups, training, giving, church finances, visitor follow-up, communication, events, forms, sermons and reports in one place, and gives every church a public page. It runs in a web browser on any phone or computer.",
  },
  {
    q: "How much does it cost?",
    a: "Every church gets its first seven Sundays free with no card required. After that there are paid plans priced in Naira, differing mainly by how many members you can hold. Email is free and unlimited on every plan; SMS is paid per message from a wallet you top up.",
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
    a: "It works anywhere with an internet connection and supports more than 30 African currencies. It is built with Nigeria and the rest of Africa in mind — address formats, currencies and SMS routes are set up for that context first.",
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
