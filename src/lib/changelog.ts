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
