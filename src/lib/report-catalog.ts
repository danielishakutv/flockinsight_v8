/**
 * The catalogue of downloadable datasets.
 *
 * Pure metadata, no DB imports, so the browser UI and the server export both
 * read the same list — one place to add a dataset, and no chance of the page
 * offering a download the server doesn't know how to build.
 *
 * A note on shape: these exports are for ANALYSIS, not for re-import. That's
 * why every row leads with its own id and carries the foreign keys beside the
 * readable labels — `member_id` next to `member_name` — so the files can be
 * joined back together in a spreadsheet, Power BI or pandas. The existing
 * `/members/export` and `/giving/export` stay as they are: those are
 * round-trip formats that must match the importer.
 */

export type CategoryKey =
  | "people"
  | "attendance"
  | "giving"
  | "contributions"
  | "finance"
  | "groups"
  | "engagement"
  | "communication"
  | "account";

export type Category = {
  key: CategoryKey;
  label: string;
  description: string;
};

export const CATEGORIES: Category[] = [
  {
    key: "people",
    label: "People",
    description: "Everyone on your register, their households and how the roll has grown.",
  },
  {
    key: "attendance",
    label: "Attendance",
    description: "Services, every headcount recorded, and individual check-ins.",
  },
  {
    key: "giving",
    label: "Giving",
    description: "Every entry, plus categories, projects and pledges.",
  },
  {
    key: "contributions",
    label: "Group contributions",
    description:
      "What each group collected together, who put in what, and where the money went.",
  },
  {
    key: "finance",
    label: "Finance",
    description:
      "Income and expense records, the accounts they sit in, and what each category came to.",
  },
  {
    key: "groups",
    label: "Groups & ministries",
    description: "Groups and who belongs to which.",
  },
  {
    key: "engagement",
    label: "Engagement",
    description: "Follow-up, events, forms, devotionals and subscribers.",
  },
  {
    key: "communication",
    label: "Communication",
    description: "Every message sent, and what happened to each recipient.",
  },
  {
    key: "account",
    label: "Account & operations",
    description: "Team, roles, wallet, payments, media and support.",
  },
];

/** How one dataset joins to another — rendered in the data dictionary. */
export type Join = { column: string; target: string };

export type Dataset = {
  id: string;
  label: string;
  /** What the file contains, in a sentence. */
  description: string;
  category: CategoryKey;
  /** Permission needed to download it. The owner always may. */
  perm: string;
  /** One row per …. Helps people know what they're looking at. */
  grain: string;
  /** The column a date range filters on. Absent = the whole set, always. */
  dateColumn?: string;
  /** Foreign keys carried in the file. */
  joins?: Join[];
};

export const DATASETS: Dataset[] = [
  /* ------------------------------ People ------------------------------ */
  {
    id: "members",
    label: "Members",
    description:
      "Every person on the register with their contact details, status, address, milestones, follow-up state, and — for first-time worshippers — when they first visited and who invited them.",
    category: "people",
    perm: "members.view",
    grain: "One row per member",
    dateColumn: "joined_at",
    joins: [
      { column: "household_id", target: "households.household_id" },
      { column: "guardian_id", target: "members.member_id" },
      { column: "invited_by_id", target: "members.member_id" },
      { column: "assigned_to_id", target: "team.user_id" },
    ],
  },
  {
    id: "households",
    label: "Households",
    description: "Family groupings, their head, and how many people are in each.",
    category: "people",
    perm: "members.view",
    grain: "One row per household",
    joins: [{ column: "head_member_id", target: "members.member_id" }],
  },
  {
    id: "member-growth",
    label: "Membership growth by month",
    description:
      "New members registered each month with a running total — the series behind the growth chart.",
    category: "people",
    perm: "members.view",
    grain: "One row per month",
    dateColumn: "joined_at",
  },

  /* ---------------------------- Attendance ---------------------------- */
  {
    id: "services",
    label: "Services",
    description: "The services you run, when they meet, and how many sessions each has.",
    category: "attendance",
    perm: "attendance.view",
    grain: "One row per service",
  },
  {
    id: "attendance-sessions",
    label: "Attendance sessions",
    description:
      "Every headcount recorded, broken down by adults, teens, children, first-timers and new converts — each split by gender.",
    category: "attendance",
    perm: "attendance.view",
    grain: "One row per recorded service",
    dateColumn: "date",
    joins: [{ column: "service_id", target: "services.service_id" }],
  },
  {
    id: "attendance-records",
    label: "Individual check-ins",
    description:
      "Per-person attendance, where members were marked present rather than only counted.",
    category: "attendance",
    perm: "attendance.view",
    grain: "One row per member per session",
    dateColumn: "session_date",
    joins: [
      { column: "session_id", target: "attendance-sessions.session_id" },
      { column: "member_id", target: "members.member_id" },
    ],
  },

  /* ------------------------------ Giving ------------------------------ */
  {
    id: "giving",
    label: "Giving entries",
    description:
      "Every recorded gift with its amount, method, category, giver, and the project or pledge it counts towards.",
    category: "giving",
    perm: "giving.view",
    grain: "One row per gift",
    dateColumn: "date",
    joins: [
      { column: "category_id", target: "giving-categories.category_id" },
      { column: "member_id", target: "members.member_id" },
      { column: "project_id", target: "projects.project_id" },
      { column: "pledge_id", target: "pledges.pledge_id" },
    ],
  },
  /* ------------------------------ Finance ----------------------------- */
  {
    id: "finance-transactions",
    label: "Income & expenses",
    description:
      "Every finance record with its amount, direction, account, category, payee and reference.",
    category: "finance",
    perm: "finance.view",
    grain: "One row per record",
    dateColumn: "date",
    joins: [
      { column: "account_id", target: "finance-accounts.account_id" },
      { column: "category_id", target: "finance-categories.category_id" },
    ],
  },
  {
    id: "finance-accounts",
    label: "Finance accounts",
    description:
      "Each account with its opening balance, what has gone in and out, and the balance today.",
    category: "finance",
    perm: "finance.view",
    grain: "One row per account",
  },
  {
    id: "finance-categories",
    label: "Finance categories",
    description:
      "Your income and expense categories with the number of records and total in each.",
    category: "finance",
    perm: "finance.view",
    grain: "One row per category",
  },
  {
    id: "giving-categories",
    label: "Giving categories",
    description: "Your categories with the number of entries and total raised in each.",
    category: "giving",
    perm: "giving.view",
    grain: "One row per category",
  },
  {
    id: "projects",
    label: "Projects & appeals",
    description:
      "Fundraising projects with their target, what has been pledged, and what has actually come in.",
    category: "giving",
    perm: "giving.view",
    grain: "One row per project",
  },
  {
    id: "pledges",
    label: "Pledges",
    description:
      "Every pledge with the amount promised, what has been paid against it, and the balance outstanding.",
    category: "giving",
    perm: "giving.view",
    grain: "One row per pledge",
    dateColumn: "start_date",
    joins: [
      { column: "project_id", target: "projects.project_id" },
      { column: "member_id", target: "members.member_id" },
    ],
  },

  /* -------------------------- Contributions --------------------------- */
  {
    id: "contributions",
    label: "Group contributions",
    description:
      "Every collection a group has run, with the goal, what was confirmed, what is still awaiting confirmation, what went out and what is still held.",
    category: "contributions",
    perm: "contributions.view",
    grain: "One row per collection",
    dateColumn: "created_at",
    joins: [{ column: "group_id", target: "groups.group_id" }],
  },
  {
    id: "contribution-payments",
    label: "Contribution payments in",
    description:
      "Every payment recorded toward a collection, who it came from, who confirmed it, and whether it counts.",
    category: "contributions",
    perm: "contributions.view",
    grain: "One row per payment",
    dateColumn: "paid_on",
    joins: [
      { column: "contribution_id", target: "contributions.contribution_id" },
      { column: "member_id", target: "members.member_id" },
    ],
  },
  {
    id: "contribution-payouts",
    label: "Contribution payments out",
    description:
      "Every naira that left a collection — handed to the church, spent, withdrawn or refunded — with who approved it.",
    category: "contributions",
    perm: "contributions.view",
    grain: "One row per payment out",
    dateColumn: "paid_on",
    joins: [{ column: "contribution_id", target: "contributions.contribution_id" }],
  },

  /* ------------------------------ Groups ------------------------------ */
  {
    id: "groups",
    label: "Groups & ministries",
    description: "Each group, when it meets, its size and who leads it.",
    category: "groups",
    perm: "groups.view",
    grain: "One row per group",
  },
  {
    id: "group-memberships",
    label: "Group membership",
    description:
      "Who belongs to which group, whether they lead it, and the title they hold — the join table for group analysis.",
    category: "groups",
    perm: "groups.view",
    grain: "One row per person per group",
    joins: [
      { column: "group_id", target: "groups.group_id" },
      { column: "member_id", target: "members.member_id" },
    ],
  },

  /* ---------------------------- Engagement ---------------------------- */
  {
    id: "follow-ups",
    label: "Follow-up interactions",
    description: "Every call, visit and message logged against a person being followed up.",
    category: "engagement",
    perm: "followup.view",
    grain: "One row per interaction",
    dateColumn: "occurred_at",
    joins: [{ column: "member_id", target: "members.member_id" }],
  },
  {
    id: "meetings",
    label: "Meetings",
    description:
      "Virtual meetings with when they ran, how long for, and how many joined.",
    category: "engagement",
    perm: "meetings.view",
    grain: "One row per meeting",
    dateColumn: "scheduled_for",
  },
  {
    id: "meeting-attendance",
    label: "Meeting attendance",
    description:
      "Every visit to every meeting — who joined, when they arrived, when they left and for how long.",
    category: "engagement",
    perm: "meetings.view",
    grain: "One row per person per visit",
    dateColumn: "joined_at",
    joins: [
      { column: "meeting_id", target: "meetings.meeting_id" },
      { column: "member_id", target: "members.member_id" },
    ],
  },
  {
    id: "events",
    label: "Events",
    description: "Programmes and events with their venue, timing and guest count.",
    category: "engagement",
    perm: "settings.manage",
    grain: "One row per event",
    dateColumn: "date",
  },
  {
    id: "event-guests",
    label: "Event guests",
    description: "Invited guests and ministers per event, with their contact details.",
    category: "engagement",
    perm: "settings.manage",
    grain: "One row per guest per event",
    joins: [{ column: "event_id", target: "events.event_id" }],
  },
  {
    id: "forms",
    label: "Forms",
    description: "Your forms, their status and how many responses each has collected.",
    category: "engagement",
    perm: "forms.view",
    grain: "One row per form",
  },
  {
    id: "form-responses",
    label: "Form responses",
    description:
      "Every submission, with the answers as JSON so a form's own questions survive the export.",
    category: "engagement",
    perm: "forms.view",
    grain: "One row per response",
    dateColumn: "submitted_at",
    joins: [
      { column: "form_id", target: "forms.form_id" },
      { column: "member_id", target: "members.member_id" },
    ],
  },
  {
    id: "devotionals",
    label: "Devotionals & newsletters",
    description: "What you published or sent, to whom, and how many it reached.",
    category: "engagement",
    perm: "devotionals.view",
    grain: "One row per devotional or newsletter",
    dateColumn: "created_at",
  },
  {
    id: "subscribers",
    label: "Newsletter subscribers",
    description: "Everyone subscribed to your mailing list and where they signed up.",
    category: "engagement",
    perm: "devotionals.view",
    grain: "One row per subscriber",
    dateColumn: "created_at",
  },

  /* --------------------------- Communication --------------------------- */
  {
    id: "messages",
    label: "Messages sent",
    description:
      "Every SMS, email and in-app notice sent, with how many were delivered, failed or skipped, and what it cost.",
    category: "communication",
    perm: "communication.view",
    grain: "One row per send",
    dateColumn: "created_at",
  },
  {
    id: "message-recipients",
    label: "Message recipients",
    description:
      "The per-person outcome of each send — who it reached, who it didn't, and why.",
    category: "communication",
    perm: "communication.view",
    grain: "One row per recipient per send",
    dateColumn: "created_at",
    joins: [
      { column: "message_id", target: "messages.message_id" },
      { column: "member_id", target: "members.member_id" },
    ],
  },

  /* ------------------------------ Account ------------------------------ */
  {
    id: "team",
    label: "Team",
    description: "Everyone with a login, their role, and how to reach them.",
    category: "account",
    perm: "team.manage",
    grain: "One row per team member",
    joins: [{ column: "member_id", target: "members.member_id" }],
  },
  {
    id: "roles",
    label: "Roles & permissions",
    description: "Each role, the permissions it grants, and how many people hold it.",
    category: "account",
    perm: "team.manage",
    grain: "One row per role",
  },
  {
    id: "wallet",
    label: "Wallet transactions",
    description: "Every credit and debit on your wallet, with the running balance.",
    category: "account",
    perm: "settings.manage",
    grain: "One row per transaction",
    dateColumn: "created_at",
  },
  {
    id: "payments",
    label: "Subscription payments",
    description: "Plan payments with their gateway, reference and status.",
    category: "account",
    perm: "settings.manage",
    grain: "One row per payment",
    dateColumn: "created_at",
  },
  {
    id: "media",
    label: "Media library",
    description:
      "Details of every uploaded file — name, type and size. The files themselves are not included.",
    category: "account",
    perm: "media.view",
    grain: "One row per file",
    dateColumn: "created_at",
  },
  {
    id: "support-tickets",
    label: "Support tickets",
    description: "Tickets you've raised with FlockInsight and where each stands.",
    category: "account",
    perm: "settings.manage",
    grain: "One row per ticket",
    dateColumn: "created_at",
  },
  {
    id: "usage",
    label: "Daily usage",
    description:
      "Counters per metric per day — SMS sent, emails sent and the rest — for cost and activity analysis.",
    category: "account",
    perm: "settings.manage",
    grain: "One row per metric per day",
    dateColumn: "day",
  },
];

export const DATASET_IDS = DATASETS.map((d) => d.id);

export function getDataset(id: string): Dataset | undefined {
  return DATASETS.find((d) => d.id === id);
}

/**
 * Whether someone may download a dataset. Mirrors `lib/permissions` — the
 * owner sees everything, everyone else needs the dataset's own permission.
 */
export function canDownload(
  dataset: Dataset,
  perms: readonly string[],
  isOwner: boolean,
): boolean {
  return isOwner || perms.includes(dataset.perm);
}

export function allowedDatasets(
  perms: readonly string[],
  isOwner: boolean,
): Dataset[] {
  return DATASETS.filter((d) => canDownload(d, perms, isOwner));
}

/* -------------------------------------------------------------------------
 * Saying it in English
 *
 * The reports page used to print a dataset's wiring exactly as it is stored:
 * "Filtered by created at" and "Joins to `household_id ->
 * households.household_id`". That is the column name with the underscores
 * taken out, which is not the same thing as plain language — the same habit
 * that filled the summary PDF with foreign keys until a church asked why
 * their report was technical jargon instead of real data.
 *
 * The two helpers below turn the stored wiring into something a church
 * administrator can read, without throwing away what an analyst needs: the
 * exact keys are kept on `keys` so the page can still show them on hover.
 * ---------------------------------------------------------------------- */

/**
 * What each date column means, said once.
 *
 * Keyed by column rather than by dataset because the ten columns below cover
 * all thirty-six datasets, and a per-dataset sentence would be thirty-six
 * chances to leave one stale.
 */
const DATE_FILTER_PHRASE: Record<string, string> = {
  joined_at: "when the person joined",
  date: "the date on the record",
  session_date: "the date of the service",
  start_date: "the date it started",
  created_at: "when it was first recorded",
  paid_on: "when it was paid",
  occurred_at: "when it happened",
  scheduled_for: "when it was scheduled for",
  submitted_at: "when it was submitted",
  day: "the day it counts towards",
};

/**
 * "A date range applies to when the person joined", or null when the dataset
 * has no date to filter on and is always exported whole.
 */
export function dateFilterPhrase(dataset: Dataset): string | null {
  if (!dataset.dateColumn) return null;
  /*
   * An unmapped column falls back to the column name rather than to silence.
   * A new dataset with an unlisted date column should read slightly awkwardly
   * and get fixed, not disappear from the page — and `catalogPhrasesComplete`
   * fails the build before it ever ships.
   */
  const phrase =
    DATE_FILTER_PHRASE[dataset.dateColumn] ??
    dataset.dateColumn.replace(/_/g, " ");
  return `A date range applies to ${phrase}.`;
}

/** Another dataset this one links to, named the way the page names it. */
export type LinkedDataset = {
  id: string;
  label: string;
  /** The exact foreign keys, for whoever is going to join the files. */
  keys: string[];
  /** True when the link points back at this same dataset (a guardian, a parent group). */
  self: boolean;
};

/**
 * Which other files this one can be joined to, by label rather than by key.
 *
 * Several columns can point at the same dataset — members carries both a
 * guardian and an assigned-to link — so they are grouped, and the keys travel
 * with them rather than being dropped.
 */
export function linkedDatasets(dataset: Dataset): LinkedDataset[] {
  const byTarget = new Map<string, LinkedDataset>();

  for (const join of dataset.joins ?? []) {
    const targetId = join.target.split(".")[0];
    const existing = byTarget.get(targetId);
    if (existing) {
      existing.keys.push(join.column);
      continue;
    }
    byTarget.set(targetId, {
      id: targetId,
      label: getDataset(targetId)?.label ?? targetId,
      keys: [join.column],
      self: targetId === dataset.id,
    });
  }

  return [...byTarget.values()];
}

/**
 * Every date column in the catalogue has a phrase, and every join points at a
 * dataset that exists. Asserted by a test, so adding a dataset with a new date
 * column or a typo'd target fails the build instead of printing `occurred_at`
 * at a church administrator.
 */
export function catalogPhrasesComplete(): {
  unphrasedDateColumns: string[];
  unknownJoinTargets: string[];
} {
  const unphrasedDateColumns = [
    ...new Set(
      DATASETS.map((d) => d.dateColumn).filter(
        (c): c is string => !!c && !(c in DATE_FILTER_PHRASE),
      ),
    ),
  ];

  const known = new Set(DATASET_IDS);
  const unknownJoinTargets = [
    ...new Set(
      DATASETS.flatMap((d) => d.joins ?? [])
        .map((j) => j.target.split(".")[0])
        .filter((id) => !known.has(id)),
    ),
  ];

  return { unphrasedDateColumns, unknownJoinTargets };
}
