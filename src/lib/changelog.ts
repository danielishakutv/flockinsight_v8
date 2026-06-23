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
