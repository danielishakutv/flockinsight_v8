/**
 * Help & guides content. Pure data (icons referenced by key so it can be passed
 * to client components). Rendered by /help and /help/[slug].
 */

export type GuideSection = { title?: string; body: string[] };
export type GuideLink = { label: string; href: string };

export type Guide = {
  slug: string;
  title: string;
  category: string; // category key
  icon: string; // icon key (see help/icons.ts)
  summary: string;
  minutes: number;
  sections: GuideSection[];
  links: GuideLink[];
  tip?: string;
  keywords?: string[];
};

export const GUIDE_CATEGORIES: { key: string; title: string }[] = [
  { key: "start", title: "Getting started" },
  { key: "people", title: "Members & people" },
  { key: "services", title: "Services & attendance" },
  { key: "giving", title: "Giving" },
  { key: "comms", title: "Communication & SMS" },
  { key: "content", title: "Content & engagement" },
  { key: "public", title: "Your public page" },
  { key: "account", title: "Account, billing & team" },
];

export const GUIDES: Guide[] = [
  {
    slug: "getting-started",
    title: "Getting started with FlockInsight",
    category: "start",
    icon: "sparkles",
    summary: "Set up your church in minutes — the first things to do.",
    minutes: 4,
    sections: [
      {
        title: "Your first 10 minutes",
        body: [
          "Set your church profile: name, country/state, timezone and currency in Settings → General. The timezone matters for reminders and dates.",
          "Add your services (e.g. Sunday Service, Midweek) in Settings → Services — these power attendance and automatic reminders.",
          "Add a few members, or bulk-import them from a spreadsheet (Members → Import).",
          "Record your first attendance from the dashboard's Record button.",
        ],
      },
      {
        title: "Find your way around",
        body: [
          "The dashboard shows key numbers, upcoming birthdays & anniversaries, and a to-do list.",
          "Everything is in the left menu (or the More menu on mobile): Attendance, Analytics, Members, Groups, Giving, Follow-up, Communication, Media, Forms and Devotionals.",
          "Settings is now a clean, grouped menu (Church, Engagement, Billing, People) — no more sideways scrolling.",
        ],
      },
    ],
    links: [
      { label: "General settings", href: "/settings" },
      { label: "Add services", href: "/settings/services" },
      { label: "Add members", href: "/members" },
    ],
    tip: "Invite your team early (Settings → Team) so others can help set things up.",
    keywords: ["setup", "begin", "start", "onboarding", "first"],
  },
  {
    slug: "members",
    title: "Adding & managing members",
    category: "people",
    icon: "members",
    summary: "Build your member directory, import in bulk and keep profiles rich.",
    minutes: 5,
    sections: [
      {
        title: "Add members",
        body: [
          "Go to Members → Add member. Capture names, gender, phone, email, address, date of birth and milestones (wedding, baptism, other anniversaries).",
          "Phone and email are used for SMS and email reminders — add them to reach members.",
        ],
      },
      {
        title: "Import from a spreadsheet",
        body: [
          "Members → Import. Download the template, fill it in, and upload. We match columns by their headers.",
          "You can export your members at any time from Members → Export.",
        ],
      },
      {
        title: "Member profiles",
        body: [
          "Click any member to see their full profile, the groups they belong to, and their milestones.",
          "Birthdays and anniversaries in the next 14 days appear automatically on the dashboard.",
        ],
      },
    ],
    links: [
      { label: "Open Members", href: "/members" },
      { label: "Dashboard", href: "/dashboard" },
    ],
    tip: "Member limits depend on your plan — see Billing if you hit the cap.",
    keywords: ["member", "people", "import", "csv", "anniversary", "birthday", "baptism"],
  },
  {
    slug: "groups",
    title: "Ministries & groups",
    category: "people",
    icon: "groups",
    summary: "Organise people into ministries, departments, cells and classes.",
    minutes: 3,
    sections: [
      {
        title: "Create a group",
        body: [
          "Go to Groups → New. Choose a type (ministry, department, group, cell, committee or class) and name it.",
          "Add members to the group and mark leaders where relevant.",
        ],
      },
    ],
    links: [{ label: "Open Groups", href: "/groups" }],
    keywords: ["group", "ministry", "department", "cell", "class", "committee"],
  },
  {
    slug: "follow-up",
    title: "Following up visitors & new converts",
    category: "people",
    icon: "followup",
    summary: "Track visitors through stages and log every interaction.",
    minutes: 4,
    sections: [
      {
        title: "How follow-up works",
        body: [
          "Visitors and new converts are added to Follow-up automatically; you can also add any member manually.",
          "Move people through stages: New → Contacted → In progress → Joined (or Not interested).",
        ],
      },
      {
        title: "Log interactions",
        body: [
          "Open a person and log visits, calls, WhatsApp, emails or notes — each is saved to their history.",
          "Send an SMS directly from their profile (requires an approved sender ID and wallet balance).",
          "Assign follow-up to a team member so nothing slips.",
        ],
      },
    ],
    links: [{ label: "Open Follow-up", href: "/follow-up" }],
    keywords: ["follow up", "visitor", "convert", "care", "retention"],
  },
  {
    slug: "services",
    title: "Setting up services",
    category: "services",
    icon: "services",
    summary: "Define your recurring services — they power attendance & reminders.",
    minutes: 3,
    sections: [
      {
        title: "Add a service",
        body: [
          "Settings → Services → Add. Give it a name, the day of the week and a start time.",
          "Active services appear when recording attendance and on your public page, and they drive automatic reminders.",
        ],
      },
    ],
    links: [{ label: "Manage services", href: "/settings/services" }],
    keywords: ["service", "schedule", "sunday", "midweek", "time"],
  },
  {
    slug: "attendance",
    title: "Recording attendance",
    category: "services",
    icon: "attendance",
    summary: "Take fast headcounts and track attendance over time.",
    minutes: 3,
    sections: [
      {
        title: "Record a session",
        body: [
          "Tap Record (top bar or dashboard). Pick the service and date, then enter headcounts (total, male, female, children, first-timers).",
          "Save — the dashboard and analytics update with trends instantly.",
        ],
      },
      {
        title: "Review history",
        body: [
          "Open Attendance to see past sessions, and Analytics for trends and breakdowns.",
          "Export attendance to CSV or PDF for your records.",
        ],
      },
    ],
    links: [
      { label: "Record attendance", href: "/attendance/record" },
      { label: "View attendance", href: "/attendance" },
      { label: "Analytics", href: "/analytics" },
    ],
    keywords: ["attendance", "headcount", "record", "service", "count"],
  },
  {
    slug: "giving",
    title: "Recording giving",
    category: "giving",
    icon: "giving",
    summary: "Track tithes, offerings and donations by category.",
    minutes: 4,
    sections: [
      {
        title: "Set up categories",
        body: [
          "Settings → Giving to create categories (Tithe, Offering, Building, etc.).",
        ],
      },
      {
        title: "Record a gift",
        body: [
          "Open Giving → Add. Choose the category, amount, date and (optionally) the member and method.",
          "See totals and breakdowns on the dashboard and in Analytics, and export anytime.",
        ],
      },
    ],
    links: [
      { label: "Open Giving", href: "/giving" },
      { label: "Giving categories", href: "/settings/giving" },
    ],
    keywords: ["giving", "tithe", "offering", "donation", "finance", "money"],
  },
  {
    slug: "communication",
    title: "Sending SMS, email & notices",
    category: "comms",
    icon: "comms",
    summary: "Reach members in bulk, by group or individually with templates.",
    minutes: 5,
    sections: [
      {
        title: "Send a message",
        body: [
          "Open Communication. Choose a channel — SMS, email, or a staff notice.",
          "Pick recipients: everyone, a group, or selected members. Use a template and personalise with {name} and {church}.",
          "SMS needs an approved sender ID and wallet balance; email is free.",
        ],
      },
    ],
    links: [
      { label: "Open Communication", href: "/communication" },
      { label: "Set up SMS", href: "/settings/sms" },
    ],
    keywords: ["communication", "broadcast", "bulk", "sms", "email", "notice", "template"],
  },
  {
    slug: "sms-sender-id",
    title: "Getting an SMS sender ID & topping up",
    category: "comms",
    icon: "sms",
    summary: "Apply for the name your SMS comes from, and fund your SMS wallet.",
    minutes: 5,
    sections: [
      {
        title: "Apply for a sender ID",
        body: [
          "Settings → SMS. Enter the name recipients will see as the sender (3–11 characters: letters, numbers, spaces or hyphens, e.g. GraceChapel).",
          "We submit it for approval automatically. Use Check approval status to see when it's approved — this can take a few hours.",
          "If a sender ID is already approved on the network, it's adopted instantly; you can't take a name another church already uses.",
        ],
      },
      {
        title: "Fund your wallet",
        body: [
          "Your church now has one unified wallet (Settings → Wallet) that funds SMS, storage upgrades and more. Top up via card or transfer (Paystack).",
          "Each SMS page (160 characters) is deducted per recipient when you send. Reminders and broadcasts pause automatically if the wallet runs out.",
        ],
      },
    ],
    links: [
      { label: "SMS settings", href: "/settings/sms" },
      { label: "Wallet", href: "/settings/wallet" },
    ],
    tip: "Long messages use multiple SMS pages — keep texts concise to save credits.",
    keywords: ["sms", "sender id", "wallet", "credit", "top up", "termii"],
  },
  {
    slug: "reminders",
    title: "Automatic service reminders",
    category: "comms",
    icon: "reminders",
    summary: "Remind members about services automatically by email or SMS.",
    minutes: 4,
    sections: [
      {
        title: "Turn on reminders",
        body: [
          "Settings → Reminders. Switch on, choose channels (email and/or SMS), and whether to send the day before or on the service day.",
          "Pick the time of day (your timezone) and who to send to (active or all members).",
          "Edit the email and SMS templates — placeholders {name}, {church}, {service}, {day} and {time} fill in automatically. Use Email me a test to preview.",
        ],
      },
    ],
    links: [
      { label: "Reminder settings", href: "/settings/reminders" },
      { label: "Add services", href: "/settings/services" },
    ],
    tip: "Reminders only fire for active services — make sure yours have a day and time.",
    keywords: ["reminder", "automatic", "service day", "schedule", "notify"],
  },
  {
    slug: "celebrations",
    title: "Birthday & anniversary messages",
    category: "comms",
    icon: "celebrations",
    summary: "Automatically wish members on their birthdays and anniversaries.",
    minutes: 3,
    sections: [
      {
        title: "Turn it on",
        body: [
          "Settings → Celebrations. Switch on, choose channels (email and/or SMS) and the time of day to send (your timezone).",
          "Edit the birthday and anniversary templates — placeholders {name}, {church} and {occasion} fill in automatically.",
        ],
      },
      {
        title: "What's covered",
        body: [
          "Birthdays are taken from each member's date of birth; weddings, baptisms and any custom anniversaries you've added are celebrated on their day.",
          "Make sure members have the relevant dates on their profile so no one is missed.",
        ],
      },
    ],
    links: [
      { label: "Celebration settings", href: "/settings/celebrations" },
      { label: "Members", href: "/members" },
    ],
    tip: "Birthdays & anniversaries in the next 14 days also show on your dashboard.",
    keywords: ["birthday", "anniversary", "celebration", "wedding", "baptism", "auto message"],
  },
  {
    slug: "media",
    title: "Media library",
    category: "content",
    icon: "media",
    summary: "Upload sermons, photos and files — then share links or downloads.",
    minutes: 4,
    sections: [
      {
        title: "Upload files",
        body: [
          "Open Media → Upload files. Pick a category (Sermon, Photo, or Document/Other) and choose any file: audio, video, images, PDFs and more.",
          "Images and videos are automatically optimised and resized as they upload, so they take up far less space.",
        ],
      },
      {
        title: "Share & download",
        body: [
          "Each file has a Copy link button (a shareable link), a download option, and inline players for audio and video.",
          "Use it for sermon recordings, bulletins, flyers, photo galleries — anything your church needs to store or share.",
        ],
      },
      {
        title: "Storage",
        body: [
          "Every church gets 200MB of free storage, shown as a live usage bar at the top of the library.",
          "Need more? Upgrade with a monthly storage add-on, paid from your church wallet (Settings → Storage).",
        ],
      },
    ],
    links: [
      { label: "Open Media", href: "/media" },
      { label: "Storage", href: "/settings/storage" },
    ],
    keywords: ["media", "sermon", "audio", "video", "photo", "file", "upload", "download", "storage", "cloudinary"],
  },
  {
    slug: "forms",
    title: "Building forms",
    category: "content",
    icon: "forms",
    summary: "Create your own forms, share a link and collect responses.",
    minutes: 5,
    sections: [
      {
        title: "Build a form",
        body: [
          "Open Forms → New form. Add a title and questions, choose each answer type (short text, paragraph, email, phone, number, date, dropdown, multiple choice, checkboxes, yes/no), mark fields required and reorder them.",
          "Choose your own link — e.g. flockinsight.com/f/easter-2026. Anyone can fill it in; no account needed.",
        ],
      },
      {
        title: "Publish & share",
        body: [
          "Set the form to Live, then copy the link and share it on WhatsApp, social media or your bulletin.",
          "Set it to Closed any time to stop accepting responses.",
        ],
      },
      {
        title: "Collect & manage responses",
        body: [
          "The response count updates live, with a one-click CSV export of everything.",
          "Submissions can automatically match or create a member (and optionally add them to Follow-up), and you can get an email and in-app notification on every response — each toggleable per form.",
        ],
      },
    ],
    links: [{ label: "Open Forms", href: "/forms" }],
    keywords: ["form", "survey", "registration", "responses", "google forms", "signup", "collect"],
  },
  {
    slug: "devotionals",
    title: "Devotionals & newsletters",
    category: "content",
    icon: "devotionals",
    summary: "Write devotionals and newsletters, then send them by email.",
    minutes: 5,
    sections: [
      {
        title: "Write a devotional or newsletter",
        body: [
          "Open Devotionals → New devotional (or New newsletter). Add a title, an optional cover image, and your message.",
          "Choose who receives it: your members, your subscribers, or both.",
        ],
      },
      {
        title: "Send now or schedule",
        body: [
          "Send immediately, or schedule it for a specific date and time — perfect for a daily devotional or a weekly newsletter.",
          "Sent items show how many recipients received them.",
        ],
      },
      {
        title: "Subscribers",
        body: [
          "People who sign up on your public page are added to your subscriber list automatically.",
          "Add or remove subscribers manually, see the live count, and export the full name + email list to CSV (Devotionals → Subscribers).",
        ],
      },
    ],
    links: [
      { label: "Open Devotionals", href: "/devotionals" },
      { label: "Public page", href: "/settings/public" },
    ],
    tip: "Email sending uses your church's email — no SMS credits needed for newsletters.",
    keywords: ["devotional", "newsletter", "email", "subscribers", "mailing list", "bulk email", "schedule"],
  },
  {
    slug: "events",
    title: "Events & programs",
    category: "content",
    icon: "events",
    summary: "Publish events and programs with flyers and share them.",
    minutes: 3,
    sections: [
      {
        title: "Create an event",
        body: [
          "Open Events → New. Add the title, date, time, venue and a flyer image.",
          "Public events appear on your church's public page and in the public events directory automatically.",
        ],
      },
    ],
    links: [{ label: "Open Events", href: "/my-events" }],
    keywords: ["event", "program", "flyer", "calendar", "crusade", "conference"],
  },
  {
    slug: "public-page",
    title: "Your public church page & invite link",
    category: "public",
    icon: "public",
    summary: "A modern, shareable landing page for your church — with a colour theme and a newsletter sign-up.",
    minutes: 5,
    sections: [
      {
        title: "Build your page",
        body: [
          "Settings → Public page. Set your link name (e.g. flockinsight.com/c/grace-chapel), upload a logo and cover, and write your about, denomination and tagline.",
          "Add your address, landmarks and (optionally) your map location so people can get directions. Add photos to fill the gallery.",
          "Add contact details and social links. Your service times and upcoming events appear automatically.",
        ],
      },
      {
        title: "Pick a colour theme",
        body: [
          "Choose one of 7 colour themes under Branding — it sets the accent colours and hero gradient on your public page so it matches your church's identity.",
        ],
      },
      {
        title: "Collect subscribers",
        body: [
          "Your public page includes a built-in newsletter sign-up. Anyone — not just members — can enter their name and email to subscribe.",
          "Subscribers appear under Devotionals → Subscribers, where you can see the count, export them to CSV, and email them devotionals and newsletters.",
        ],
      },
      {
        title: "Share it",
        body: [
          "Use Copy link or Share on the Public page, or the Invite card on your dashboard.",
          "Toggle 'List in public directory' to control whether people can find you in search.",
        ],
      },
    ],
    links: [
      { label: "Edit public page", href: "/settings/public" },
      { label: "Browse the directory", href: "/churches" },
    ],
    keywords: ["public", "page", "invite", "share", "directory", "profile", "link", "handle"],
  },
  {
    slug: "wallet-storage",
    title: "Wallet & storage",
    category: "account",
    icon: "wallet",
    summary: "One wallet funds SMS and storage; upgrade storage when you need more.",
    minutes: 3,
    sections: [
      {
        title: "Your wallet",
        body: [
          "Settings → Wallet shows your single church wallet balance, which funds SMS sending and storage upgrades.",
          "Top up via card or transfer (Paystack). Every credit and deduction is listed in your transaction history.",
        ],
      },
      {
        title: "Storage & upgrades",
        body: [
          "Every church gets 200MB of free storage for media and uploads. Track usage on the Media page or in Settings → Storage.",
          "Need more space? Subscribe to a monthly storage add-on (e.g. +1GB, +5GB, +10GB) — it's billed automatically from your wallet, and your files are always kept safe even if an add-on lapses.",
        ],
      },
    ],
    links: [
      { label: "Wallet", href: "/settings/wallet" },
      { label: "Storage", href: "/settings/storage" },
      { label: "Media", href: "/media" },
    ],
    keywords: ["wallet", "balance", "top up", "storage", "upgrade", "gigabyte", "quota", "paystack"],
  },
  {
    slug: "billing",
    title: "Plans & billing",
    category: "account",
    icon: "billing",
    summary: "Choose a plan, upgrade, and view your payment history.",
    minutes: 3,
    sections: [
      {
        title: "Manage your plan",
        body: [
          "Settings → Billing shows your current plan and renewal date.",
          "Upgrade or change plan — paid plans are billed monthly. Your payment history is listed there too.",
        ],
      },
    ],
    links: [
      { label: "Billing", href: "/settings/billing" },
      { label: "Compare plans", href: "/pricing" },
    ],
    keywords: ["billing", "plan", "upgrade", "subscription", "payment", "pricing"],
  },
  {
    slug: "team-roles",
    title: "Team members & permissions",
    category: "account",
    icon: "team",
    summary: "Invite staff and control what each person can access with roles.",
    minutes: 4,
    sections: [
      {
        title: "Invite your team",
        body: [
          "Settings → Team → Invite. Enter their email; they get a link to join your church.",
        ],
      },
      {
        title: "Roles & permissions",
        body: [
          "Settings → Roles to create roles (e.g. Usher, Finance) and tick exactly what each can see and do.",
          "Assign a role to each team member on the Team tab. The Owner always has full access.",
        ],
      },
    ],
    links: [
      { label: "Team", href: "/settings/team" },
      { label: "Roles", href: "/settings/roles" },
    ],
    keywords: ["team", "staff", "role", "permission", "invite", "access"],
  },
  {
    slug: "contact-support",
    title: "Contacting support",
    category: "account",
    icon: "help",
    summary: "Reach a human when you need help — and track your tickets.",
    minutes: 1,
    sections: [
      {
        title: "Open a ticket",
        body: [
          "Help & Support → Contact us. Describe your issue and submit — our team is notified by email and will reply.",
          "Your tickets and our replies are kept under Help & Support → Contact us so you can follow the conversation.",
        ],
      },
    ],
    links: [{ label: "Contact support", href: "/help/support" }],
    keywords: ["support", "contact", "ticket", "help", "email"],
  },
];

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
