/**
 * Public product changelog. Append a new entry at the TOP for each release.
 * Keep items short and user-facing — this page is public.
 *
 * Categories use a fixed set so they render with consistent colors/order.
 */
export type ChangeCategory =
  | "Added"
  | "Improved"
  | "Fixed"
  | "Changed"
  | "Security";

export type Release = {
  version: string; // e.g. "0.4.0"
  date: string; // YYYY-MM-DD
  summary?: string;
  changes: Partial<Record<ChangeCategory, string[]>>;
};

/** Render order for categories within a release. */
export const CATEGORY_ORDER: ChangeCategory[] = [
  "Added",
  "Improved",
  "Fixed",
  "Changed",
  "Security",
];

export const releases: Release[] = [
  {
    version: "0.60.0",
    date: "2026-09-04",
    summary:
      "Finance: keep the church's books alongside its giving. Record what comes in and what goes out, see what each account really holds, and give any giving category its own fund that fills up automatically.",
    changes: {
      Added: [
        "Finance: a full record of income and expenses, with your own categories for each side of the books.",
        "Accounts: name the bank account, the offering box, the mobile wallet. Each shows what it holds, worked out from what you record — plus an opening balance so a church joining mid-year starts from the truth.",
        "Giving funds: give a category like Building Project its own account, and every gift recorded in it is added as income automatically. Link a category that already has years of giving and its whole history comes with it.",
        "A fund can be spent from and moved out of, but nothing can be paid into it by hand — so its balance always reflects what was actually given.",
        "Transfers: move money between your own accounts. Balances change; income and expense totals correctly ignore it.",
        "Search the ledger by payee, reference, note or amount, and filter by type, account, category, method or date. What you download is what you were looking at.",
        "Reports gains three finance datasets, so the books join the CSV, PDF and full-export bundle like everything else.",
        "Friendlier pages when something goes wrong, including a proper page for a link that no longer exists.",
        "Every PDF now carries your church's own logo, colours and contact details instead of ours — attendance, members, giving, finance and all 31 report datasets. FlockInsight is one small line at the foot of the page.",
        "Giving statement (PDF): what came in over any period, broken down by category, with the entries behind it. The one to print for a board meeting.",
      ],
      Fixed: [
        "Pledges could get stuck marked complete. Deleting or reducing the payment that finished one left it closed while money was still owed, so it vanished from the outstanding report — and editing a payment up to the full amount never closed it. Both now settle correctly.",
        "Members who had finished paying a pledge could keep receiving reminders asking for a balance shown as 0.00, because of a rounding sliver. They stop.",
        "Deleting or editing a gift now refreshes the dashboard and its project page, instead of leaving them showing money that had moved.",
      ],
      Security: [
        "Sign-in rate limiting now counts per visitor. It was applying one shared allowance across every church, which both weakened it against an attacker and could lock real people out on a busy Sunday.",
        "Turning off a device's notifications now only ever affects that person's own device.",
        "Hardened how church logos are fetched when building a PDF, so the field can only ever point at our own image hosts.",
      ],
    },
  },
  {
    version: "0.59.0",
    date: "2026-08-28",
    summary:
      "A new Reports section: download any part of your church's data as a spreadsheet or PDF, or take everything in one file for analysis.",
    changes: {
      Added: [
        "Reports: 28 downloadable datasets covering everything FlockInsight holds for you — members, households, services, every headcount, individual check-ins, giving, categories, projects, pledges, groups and their membership, follow-up, events and guests, forms and responses, devotionals, subscribers, every message and its per-recipient outcome, your team, roles, wallet, payments, media and daily usage.",
        "Each dataset downloads as a CSV for analysis or a PDF to read and circulate.",
        "Full export: one ZIP with a spreadsheet for every dataset you can see, filed into folders by category, plus a data dictionary and a README explaining how the files fit together.",
        "Summary report (PDF): your headline numbers and a plain-English guide to every dataset — the one to hand to a board or a trustee.",
        "Filter any report by date, or use a preset: this month, last three months, this year, last year. Each report tells you which date it filters on, so a period means the same obvious thing everywhere.",
        "Built for joining: every row leads with its own id and carries the ids of whatever it relates to alongside the readable name, so the files can be combined in Excel, Google Sheets, Power BI or pandas.",
      ],
      Security: [
        "Reports respect your roles exactly. Someone without access to giving sees no giving reports, and a direct download link is refused rather than merely hidden — the permission is checked again on every download.",
      ],
    },
  },
  {
    version: "0.58.0",
    date: "2026-08-28",
    summary:
      "Verify your church with a code, get a verification tick, and hear from us by email whenever we change something on your account.",
    changes: {
      Added: [
        "Church verification: confirm your account email address and phone number with a 6-digit code (Settings → Verification). Verified churches carry a blue tick beside their name on their public page and in the church directory.",
        "Change your church's account email or phone number yourself — the new one only takes effect once you enter the code we send to it, so nobody can change your details without access to them.",
        "A reminder on your dashboard until both are verified, with a one-tap link to finish the job.",
        "Verification codes are sent by FlockInsight and cost you nothing — they don't touch your wallet balance and don't need your own SMS sender ID approved.",
      ],
      Improved: [
        "You now get an email whenever the FlockInsight team changes something on your account: a trial extended, a plan moved, your wallet credited, your church suspended or reactivated, your data reset, a denomination set, or your church linked to a headquarters. Each one says what changed, when, and how to reach us if it looks wrong.",
        "A suspended church is now told by email — previously the only notice was in an app they could no longer sign into.",
        "If support sets a new password on your account, you're emailed about it, so an unexpected change can't go unnoticed.",
      ],
      Security: [
        "Codes expire after 10 minutes, are stored only as a hash, lock after five wrong guesses, and are limited to three live codes per destination — the same protections already used for member self-service.",
      ],
    },
  },
  {
    version: "0.57.0",
    date: "2026-08-18",
    summary:
      "Run several churches from one place: link your branches to a headquarters and get one report across all of them — on screen, as a spreadsheet, or emailed to you every week.",
    changes: {
      Added: [
        "Branches: link the churches you run to a headquarters and see them together. Every branch stays a separate church with its own members, giving, team and plan — the headquarters only ever sees roll-up totals, never a branch's records.",
        "Linking needs consent: the headquarters invites, the branch accepts or declines, and either side can leave whenever they want.",
        "The branch dashboard totals members, average attendance and giving, filters by zone, state, city, country and date range, and flags any branch that hasn't recorded anything in the period.",
        "Group branches into zones — North Zone, a province, a district — and filter the whole report by them. Any filtered view can be bookmarked, shared, or exported as a spreadsheet.",
        "Automatic branch reports by email, weekly or monthly, to your team plus any extra addresses (a bishop, an overseer, a board member who doesn't use the app).",
      ],
      Improved: [
        "Every dropdown with more than a handful of options now has a search box — members, countries, states, categories, timezones, roles and the rest. It ignores accents and capitals, accepts words in any order, and matches phone numbers however they're punctuated.",
        "Faster, quieter platform admin for the FlockInsight team, so support answers arrive sooner.",
      ],
      Security: [
        "CSV exports are now hardened against spreadsheet formula injection — a mischievous name in your data can no longer become a live formula in Excel. Amounts still export as numbers you can sum.",
        "Updated the framework and login system to the latest patched releases.",
      ],
    },
  },
  {
    version: "0.56.0",
    date: "2026-07-27",
    summary:
      "See who still owes on their pledges, view each member's pledges, and auto-remind members with an outstanding balance.",
    changes: {
      Added: [
        "Giving → Projects → Outstanding: a report of every pledge with a balance still to give — filter by project, see totals pledged / received / outstanding, and download it as a CSV.",
        "Each member's profile now shows a Pledges card — their commitments across projects with paid vs outstanding.",
        "Pledge reminders: turn on a gentle nudge (email/SMS, with editable wording and a blessing) to members who still owe on a pledge — sent once per period (weekly / monthly / quarterly / yearly) until it's paid off. Manage it in Settings → Giving.",
      ],
    },
  },
  {
    version: "0.55.0",
    date: "2026-07-27",
    summary:
      "Fundraising projects & pledges — run a building fund, track each member's pledge, and record payments to completion.",
    changes: {
      Added: [
        "Giving → Projects: create a fundraising project (e.g. a building fund) with an optional target, and watch a live progress bar as money comes in.",
        "Add a pledge for any member (or a named non-member) — a total amount plus how they'll give: lump sum, or weekly / monthly / quarterly / yearly (with a custom option so the frequency is fully editable).",
        "Record each payment toward a pledge; every payment is a normal giving record, so it flows into your giving totals, receipts and reports — while the pledge shows paid vs outstanding and auto-completes when fully paid.",
        "Giving records that belong to a project now carry a project badge, and the CSV export includes a Project column.",
      ],
    },
  },
  {
    version: "0.54.0",
    date: "2026-07-25",
    summary:
      "Self-update links are now single-use, with an optional verification step.",
    changes: {
      Improved: [
        "A member's self-update link now works only once — after they save, generate a fresh link from their profile to let them update again.",
        "A used or expired link now shows a friendly note instead of an error.",
      ],
      Added: [
        "New toggle in Settings → Sign-up link: require a member to enter a one-time code (sent to their email/phone on file) before their self-update is saved.",
      ],
    },
  },
  {
    version: "0.53.0",
    date: "2026-07-25",
    summary:
      "Give members a personal link to update their own details, and thank givers with an automatic receipt & blessing.",
    changes: {
      Added: [
        "Every member now has a personal, pre-filled self-update link. Share it (copy, email or text it from their profile) and they can review and correct what you already have on file — and add their children — with no account needed.",
        "The link is private to each member and can be regenerated at any time to revoke an old one.",
        "Giving receipts: when you record a tithe, offering or donation for a member, you can automatically email/SMS them a thank-you and a blessing. Turn it on and edit the wording in Settings → Giving.",
        "Each gift has a “Send receipt & blessing” toggle so you stay in control per entry, and every receipt shows up in your message history.",
      ],
    },
  },
  {
    version: "0.52.0",
    date: "2026-07-24",
    summary:
      "Group families into households, and attach registration/sign-up forms to your events.",
    changes: {
      Added: [
        "Households: an optional way to group family members together. Create one from the new Members → Households screen, or straight from a member's form, and set a head of household. Everything is optional — members never need a household.",
        "A member's profile shows their household and everyone else in it; adding a child to a parent puts them in the same household automatically.",
        "Events: attach one or more forms to an event (registration, sign-up, feedback). Create a ready-made registration form in a click, or link an existing one.",
        "A form linked to an event shows up in both places automatically — with an event badge on the Forms screen, and under the event on the Events screen.",
        "Public event pages now show a “Register for this event” button for each open form, so people can sign up directly.",
      ],
    },
  },
  {
    version: "0.51.0",
    date: "2026-07-24",
    summary:
      "Register children under their parents — counted as members, celebrated on their birthdays, and addable right from your public sign-up link.",
    changes: {
      Added: [
        "Members: mark someone as a child and link them to a parent or guardian. Children are counted as members, with their own profile that shows who their guardian is.",
        "A parent's profile now has a “Children” section with a one-tap “Add child”.",
        "Public sign-up link: parents can add their children (name, gender, birthday) when they register themselves — no account needed.",
        "Birthdays for children are celebrated too: because a child usually has no phone or email, the birthday message goes to their parent/guardian automatically.",
        "Dashboard and the Members list now show how many of your people are adults vs children, and the CSV export includes each child's guardian and relationship.",
      ],
    },
  },
  {
    version: "0.50.0",
    date: "2026-07-24",
    summary:
      "Welcome messages for people who sign themselves up, a full message history with delivery analytics, texting anyone (member or not), and a dashboard that finally shows the whole church at a glance.",
    changes: {
      Added: [
        "Sign-up link: people who register themselves now get an automatic welcome email (and an SMS if you turn it on) — write your own wording in Settings → Sign-up link.",
        "Message history & analytics: a new screen showing everything you've sent, how many were delivered, how many failed, SMS units and spend — filter by channel, date range or search, and download it all as a CSV.",
        "Communication: send an SMS or email to someone who isn't a member yet — just type or paste their phone number(s) or email address(es).",
        "Dashboard: a gender donut and member-status breakdown, a “people registered” chart for the last 6 months, and headline numbers from groups, follow-up, forms, messages, media, subscribers and events.",
      ],
      Improved: [
        "Dashboard: your member charts now show even before you've recorded any attendance.",
        "Dashboard: fewer buttons — actions that already live on the mobile bottom bar no longer repeat on the home screen.",
      ],
    },
  },
  {
    version: "0.49.0",
    date: "2026-07-15",
    summary:
      "Record a birthday even when you only know the day and month — the year is now optional.",
    changes: {
      Improved: [
        "Date of birth now uses a simple Day / Month / Year picker, and the year is optional — perfect for members who share only the day and month they were born.",
        "Birthdays without a year show as just the day and month (e.g. “Jul 15”) on the member profile, exports and PDF directory, and never show a made-up age.",
        "Importing members from CSV accepts year-less birthdays too (e.g. “07-15”), and exports keep the same format so they re-import cleanly.",
      ],
    },
  },
  {
    version: "0.48.0",
    date: "2026-07-08",
    summary:
      "Bulk member tools, a wallet & messaging dashboard card, event speakers/guests, and a smoother SMS experience.",
    changes: {
      Added: [
        "Members: select many at once to delete them, or download the selection as a CSV or a nicely formatted PDF directory.",
        "Dashboard: a new Wallet & messaging card shows your balance, emails and SMS used this month (vs your plan allowance), and quick actions.",
        "Events: add speakers & guests to any event and email or SMS them about it — all in one place.",
        "Events: copy the public link for any event, and open your public events page, straight from the Events screen.",
      ],
      Improved: [
        "After you send an SMS or email, the composer clears so you're ready to send the next one.",
        "Message history now shows the units each SMS used, with a one-tap “Reuse” to send a past message again to the same or a different audience.",
        "SMS sender ID requests now show a clear Requested → Processing → Approved status, and our team is alerted the moment you request one.",
        "Where SMS isn't available yet in your country, it's clearly marked “coming soon” — email messaging still works everywhere.",
      ],
    },
  },
  {
    version: "0.47.0",
    date: "2026-07-07",
    summary:
      "Members can now sign themselves up, first-timers are nurtured automatically, and celebrations get a home of their own.",
    changes: {
      Added: [
        "Member self-registration: share one public link and people add themselves to your church — no account needed. Find it on the Members page (“Public link”), in Forms, or under Settings → Sign-up link.",
        "Smart duplicate handling: if someone already exists, they must confirm a one-time code (by email or SMS) before their details are updated — so nobody can overwrite someone else's record, and you never get duplicates.",
        "People can pick the ministries, departments and groups they belong to right on the sign-up form.",
        "First-timer follow-up: automatically thank new visitors, then invite them to become full members after a couple of weeks — with the invite link that converts them from visitor to member in one tap (Settings → First-timers).",
        "A new Celebrations page lists every upcoming birthday and anniversary, filterable by type (birthday, wedding, baptism and more).",
        "A library of ready-made birthday & anniversary message templates to pick from as your default (Settings → Celebrations).",
        "A FlockInsight Blog at flockinsight.com/blog — helpful articles for churches, fully managed by our team.",
      ],
      Improved: [
        "Your dashboard's upcoming birthdays and anniversaries cards now link straight to the full Celebrations view.",
      ],
    },
  },
  {
    version: "0.46.1",
    date: "2026-07-06",
    changes: {
      Fixed: [
        "Analytics and dashboard stats no longer show “no data” when all your attendance records are older than 12 weeks — the charts now show the 12 weeks up to your most recent record.",
      ],
    },
  },
  {
    version: "0.46.0",
    date: "2026-07-05",
    summary: "Richer attendance headcounts: adults, teens and children — each split male/female.",
    changes: {
      Added: [
        "Attendance now captures Adults, Teens and Children separately, each split into male and female.",
        "First-timers and new converts are also recorded by gender.",
        "Analytics gained a Teens series in the weekly breakdown and demographics donut, and reports/exports include the new columns.",
      ],
      Improved: [
        "Older attendance records keep their original totals — nothing is lost, and you can add the gender split any time you edit a record.",
        "The CSV import understands the new columns (and still accepts files in the old format).",
      ],
    },
  },
  {
    version: "0.45.0",
    date: "2026-07-01",
    summary: "Launch promo: your first 7 Sundays free — plus church-branded emails.",
    changes: {
      Added: [
        "Launch promo: every new church now uses FlockInsight completely free for its first 7 Sundays. No card required.",
        "Friendly reminders go out 2 weeks, 1 week and 3 days before the trial ends — with the option to pay or request a trial extension from our team.",
        "A clean promo pop-up welcomes visitors to the site (dismissible, mobile-friendly).",
      ],
      Improved: [
        "Emails your church sends (devotionals, newsletters, reminders, celebrations, subscriber welcomes and more) now show YOUR church's name as the sender, while still delivering securely from the FlockInsight domain.",
        "Pricing on the landing and billing pages now shows the free-trial promo clearly.",
        "Note: SMS sending and storage upgrades are still funded from your church wallet, during and after the trial.",
      ],
    },
  },
  {
    version: "0.44.0",
    date: "2026-07-01",
    summary: "Media previews & background uploads, live form responses, safer backups, and SEO.",
    changes: {
      Added: [
        "Media library: preview images in a lightbox and play audio & video right in the app, with smaller thumbnails so you see more at a glance.",
        "Uploads now run in the background with a live progress bar — keep working, or leave the page, while big files finish.",
        "Form responses now update live on screen as they arrive — no refresh needed.",
        "Public church pages get a light/dark switch and an invitation for other leaders to create their own free page.",
        "New subscribers get an automatic welcome email, and your church is notified in-app the moment someone signs up.",
        "Admins can export a full backup of any church, restore a backup as a brand-new church, and safely reset a church (backup + confirmation required).",
      ],
      Improved: [
        "Church pages are now search-optimised with rich Google structured data, and public pages & events are added to the sitemap so churches get found.",
        "Added HTTPS security headers across the site.",
        "Fixed a layout overflow on the mobile dashboard.",
      ],
    },
  },
  {
    version: "0.43.0",
    date: "2026-06-30",
    summary: "Devotionals & newsletters, a redesigned church page, and cleaner settings.",
    changes: {
      Added: [
        "New Devotionals & Newsletters section: write devotionals and newsletters with a cover image, then send them by email to your members, your subscribers, or both.",
        "Schedule a devotional or newsletter to go out at a specific date and time.",
        "A newsletter sign-up form is now built into every church's public page — collect names and emails from anyone, not just members.",
        "Subscribers list with a live count and CSV export; add or remove subscribers manually too.",
        "Pick from 7 colour themes for your public church page.",
      ],
      Improved: [
        "The public church page has been redesigned into a modern, landing-page style layout that showcases your logo, cover, photos, services and events.",
        "Settings has been reorganised into a clean, grouped menu — no more sideways scrolling to find a tab.",
      ],
    },
  },
  {
    version: "0.42.0",
    date: "2026-06-29",
    summary: "Build your own forms and collect responses.",
    changes: {
      Added: [
        "New Forms section: design your own forms — add questions, choose the answer type (short text, paragraph, email, phone, number, date, dropdown, multiple choice, checkboxes, yes/no), mark fields required and reorder them.",
        "Give each form a title and choose its own shareable link (/f/your-name) — anyone can fill it in, no account needed.",
        "Responses dashboard with a one-click CSV export.",
        "Submissions can automatically match or create a member (and optionally add them to follow-up).",
        "Get an email and in-app notification on every response — each can be toggled off per form.",
      ],
    },
  },
  {
    version: "0.41.0",
    date: "2026-06-29",
    summary: "Media library, optimised storage & a unified wallet.",
    changes: {
      Added: [
        "New Media library: upload sermons, photos, documents and any other files — then play audio and video right in the app, copy a shareable link, or download.",
        "Images and videos are automatically optimised and resized as they upload, so they take up far less space.",
        "Every church gets 200MB of free storage, with a live usage bar so you always know where you stand.",
        "Upgrade your storage with monthly add-on bundles, paid straight from your church wallet.",
        "Add a profile photo to any member.",
      ],
      Changed: [
        "Your SMS balance is now a single church Wallet that funds SMS, storage upgrades and more — top up once in Settings → Wallet.",
      ],
    },
  },
  {
    version: "0.40.0",
    date: "2026-06-28",
    summary: "Admin audit log & scheduled announcements.",
    changes: {
      Added: [
        "Platform admins can schedule announcements and broadcasts to send later.",
        "An audit log records administrator actions for accountability.",
      ],
      Improved: [
        "Redesigned, fully responsive platform admin dashboard.",
      ],
    },
  },
  {
    version: "0.38.0",
    date: "2026-06-27",
    summary: "Notifications & connected staff profiles.",
    changes: {
      Added: [
        "Get notified — in-app and by email — when you're assigned a follow-up.",
        "In-app notifications for important account events.",
      ],
      Improved: [
        "The notification bell now shows a quick dropdown preview instead of jumping to the page.",
        "Team members are now linked to their own member profile, so the same person is never duplicated.",
        "Another round of mobile responsiveness polish across the dashboard.",
      ],
    },
  },
  {
    version: "0.33.0",
    date: "2026-06-26",
    summary: "Public directory, events & a fresh landing page.",
    changes: {
      Added: [
        "Public church directory at /churches, with featured churches and promo banners.",
        "Events module: create programs with flyers and share a public events page.",
        "Each church gets a public profile page with a shareable link, cover photo and gallery.",
        "Birthday and wedding/anniversary auto-messages to members by SMS and email.",
        "Help & Support hub with guides and a built-in support ticket system.",
      ],
      Improved: [
        "Revamped landing page covering the full feature set for a broader audience.",
      ],
    },
  },
  {
    version: "0.31.0",
    date: "2026-06-26",
    summary: "Stronger platform administration.",
    changes: {
      Added: [
        "Admins can securely log in as a church to help resolve issues.",
        "Full user management for platform admins, including password resets.",
        "Admin-managed pricing that flows through to the landing and pricing pages.",
      ],
      Security: [
        "Platform admins now operate from a dedicated admin area, fixing a context leak when helping a church.",
      ],
    },
  },
  {
    version: "0.26.0",
    date: "2026-06-26",
    summary: "SMS sender IDs & service reminders.",
    changes: {
      Added: [
        "Apply for your own SMS sender ID (via Termii) and track its approval status in Settings → SMS.",
        "Automatic service reminders to members before each service, by SMS and email.",
      ],
    },
  },
  {
    version: "0.19.0",
    date: "2026-06-25",
    summary: "Communication, billing & SMS wallets.",
    changes: {
      Added: [
        "Communication module: send SMS, email and staff notices to your members and groups.",
        "Subscriptions & billing with Paystack — upgrade, downgrade and see your renewal date.",
        "Per-church SMS wallet you can top up yourself via Paystack.",
        "Inactivity reminder emails to re-engage members who've been away.",
      ],
      Improved: [
        "Redesigned dashboard and desktop top bar; your to-do list now syncs across devices.",
      ],
    },
  },
  {
    version: "0.13.0",
    date: "2026-06-25",
    summary: "Install as an app, plans & notifications.",
    changes: {
      Added: [
        "Install FlockInsight as an app on your phone or desktop (PWA), with offline support.",
        "Subscription tiers with a public pricing page.",
        "In-app notifications and optional web push for updates from FlockInsight.",
        "Support for 30+ African currencies, plus an upcoming-birthdays card on the dashboard.",
      ],
    },
  },
  {
    version: "0.9.0",
    date: "2026-06-24",
    summary: "Roles, permissions & smoother invitations.",
    changes: {
      Added: [
        "Custom roles and permissions (RBAC): decide exactly what each team member can see and manage.",
      ],
      Improved: [
        "Rebuilt team invitations — invited people are recognised instantly, with no extra email verification.",
      ],
    },
  },
  {
    version: "0.7.0",
    date: "2026-06-23",
    summary: "Giving, groups & ministries.",
    changes: {
      Added: [
        "Giving module: record offerings, tithes and donations under church-defined categories, with monthly and all-time totals.",
        "Ministries & Groups: organise people into ministries, departments, cells and committees, each with one or more leaders.",
        "CSV import and export for attendance and giving.",
      ],
    },
  },
  {
    version: "0.5.0",
    date: "2026-06-07",
    summary: "Follow-up module for the care team.",
    changes: {
      Added: [
        "New Follow-up section: track visitors and new converts through stages — New, Contacted, In progress, Joined.",
        "Log visits, calls, and notes against each person, with a full interaction history.",
        "Send SMS to a member from the app (via Kudisms); sent messages are saved to their history.",
        "Assign follow-up to a team member, and add any member to follow-up manually.",
      ],
    },
  },
  {
    version: "0.4.5",
    date: "2026-06-07",
    summary: "Member profile view.",
    changes: {
      Improved: [
        "Opening a member now shows a read-only profile with an Edit button, instead of jumping straight into edit mode.",
      ],
    },
  },
  {
    version: "0.4.4",
    date: "2026-06-07",
    summary: "Member CSV import & export.",
    changes: {
      Added: [
        "Export your full member list to CSV.",
        "Import members from a CSV — with a downloadable template and a per-row report of anything skipped.",
      ],
    },
  },
  {
    version: "0.4.3",
    date: "2026-06-07",
    summary: "Faster address entry.",
    changes: {
      Added: [
        "Country and State are now dropdowns, defaulting to Nigeria and Adamawa.",
        "Local Government dropdown that loads automatically for the selected Nigerian state.",
      ],
      Improved: ["New members default their join date to today."],
    },
  },
  {
    version: "0.4.2",
    date: "2026-06-07",
    summary: "Richer member profiles.",
    changes: {
      Added: [
        "Middle name and a structured address (house, street, city, state, country) for members.",
        "A full member profile page to complete or edit every detail any time after a quick add.",
      ],
    },
  },
  {
    version: "0.4.1",
    date: "2026-06-07",
    summary: "Faster attendance export.",
    changes: {
      Added: [
        "One-click PDF download for attendance — no more print dialog.",
        "Email the attendance report as a PDF attachment to any address.",
      ],
    },
  },
  {
    version: "0.4.0",
    date: "2026-06-07",
    summary: "Data export and church management.",
    changes: {
      Added: [
        "Export attendance to CSV — opens straight in Excel or Google Sheets.",
        "Printable, church-branded attendance PDF report with totals and a service-by-service breakdown.",
        "Superadmin: permanently delete a church, behind a type-the-name confirmation.",
      ],
    },
  },
  {
    version: "0.3.0",
    date: "2026-06-07",
    summary: "Sign-up reliability and polish.",
    changes: {
      Fixed: [
        "Creating a church account no longer fails when email verification is required.",
      ],
      Added: [
        "“Resend verification email” option on the login screen.",
        "Show/hide toggle on every password field.",
      ],
      Improved: [
        "Faster landing page — now served as static content.",
        "Branded browser-tab icon (favicon).",
      ],
    },
  },
  {
    version: "0.2.0",
    date: "2026-06-06",
    summary: "Built for production.",
    changes: {
      Added: [
        "Platform superadmin dashboard: manage churches and accounts, suspend or reactivate, and view metrics.",
        "Downloadable encrypted database backups.",
        "Terms of Service and Privacy Policy pages.",
        "Transactional email for password resets and verification.",
      ],
      Security: ["Rate limiting on authentication endpoints."],
      Improved: ["Log in from any device on your local network."],
    },
  },
  {
    version: "0.1.0",
    date: "2026-06-05",
    summary: "First release.",
    changes: {
      Added: [
        "Church accounts with secure email and password sign-in.",
        "Member directory.",
        "Attendance recording with gender, children, first-timer, and new-convert counts.",
        "Dashboard and analytics with weekly trends and growth.",
        "Church settings, services, and team management.",
      ],
    },
  },
];
