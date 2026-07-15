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
