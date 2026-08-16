/**
 * Vocabulary for the growth module, safe to import from client components
 * (no database, no server-only code).
 */

export type LeadStatus =
  | "new"
  | "contacted"
  | "interested"
  | "demo"
  | "trial"
  | "converted"
  | "lost";

export type LeadActivityKind =
  | "note"
  | "call"
  | "email"
  | "sms"
  | "whatsapp"
  | "meeting"
  | "status";

/** Pipeline order — also the order shown in the funnel. */
export const LEAD_STATUSES: {
  id: LeadStatus;
  label: string;
  hint: string;
  /** Tailwind classes for the status pill. */
  tone: string;
}[] = [
  {
    id: "new",
    label: "New",
    hint: "Captured, nobody has reached out yet",
    tone: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  },
  {
    id: "contacted",
    label: "Contacted",
    hint: "First message or call has gone out",
    tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  {
    id: "interested",
    label: "Interested",
    hint: "They replied and want to know more",
    tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  },
  {
    id: "demo",
    label: "Demo booked",
    hint: "A walkthrough is scheduled or done",
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  {
    id: "trial",
    label: "Trialling",
    hint: "Account created, using the free Sundays",
    tone: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  },
  {
    id: "converted",
    label: "Converted",
    hint: "Onboarded and recording attendance",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  {
    id: "lost",
    label: "Lost",
    hint: "Not going ahead — kept for the record",
    tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  },
];

/** Statuses still worth working. */
export const OPEN_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "interested",
  "demo",
  "trial",
];

export function leadStatusMeta(status: string) {
  return LEAD_STATUSES.find((s) => s.id === status) ?? LEAD_STATUSES[0];
}

/** Suggested sources. `source` is free text, so this list is only a shortcut. */
export const LEAD_SOURCES = [
  "manual",
  "website",
  "referral",
  "directory",
  "event",
  "whatsapp",
  "instagram",
  "facebook",
  "church visit",
  "import",
] as const;

/** Kinds a person can log by hand — "status" rows are written by the system. */
export type ManualActivityKind = Exclude<LeadActivityKind, "status">;

export const ACTIVITY_KINDS: { id: ManualActivityKind; label: string }[] = [
  { id: "note", label: "Note" },
  { id: "call", label: "Phone call" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "meeting", label: "Meeting / visit" },
  { id: "email", label: "Email" },
  { id: "sms", label: "SMS" },
];

/* ------------------------------------------------------------------ *
 * Message templating
 * ------------------------------------------------------------------ */

/** The tags a campaign body may use. Shown to the composer as chips. */
export const TEMPLATE_TAGS = [
  { tag: "{name}", hint: "Contact's first name (or “there”)" },
  { tag: "{church}", hint: "Church name" },
  { tag: "{city}", hint: "City (or their state)" },
] as const;

export type TemplateVars = {
  name?: string | null;
  church?: string | null;
  city?: string | null;
};

/**
 * Fill {name}/{church}/{city} in a message. Every tag always resolves to
 * something readable — a half-filled "Hello {name}" is the classic way to
 * make a marketing message look automated.
 */
export function renderTemplate(text: string, vars: TemplateVars): string {
  const first = (vars.name ?? "").trim().split(/\s+/)[0] || "there";
  const church = (vars.church ?? "").trim() || "your church";
  const city = (vars.city ?? "").trim() || "your area";
  return text
    .replace(/\{name\}/gi, first)
    .replace(/\{church\}/gi, church)
    .replace(/\{city\}/gi, city);
}

/* ------------------------------------------------------------------ *
 * CSV import
 * ------------------------------------------------------------------ */

export type LeadImportField =
  | "churchName"
  | "contactName"
  | "role"
  | "email"
  | "phone"
  | "whatsapp"
  | "city"
  | "state"
  | "country"
  | "denomination"
  | "size"
  | "source"
  | "notes";

/** Header spellings we accept, so a list from anywhere lands in the right column. */
const HEADER_ALIASES: Record<string, LeadImportField> = {
  church: "churchName",
  "church name": "churchName",
  organisation: "churchName",
  organization: "churchName",
  ministry: "churchName",
  name: "contactName",
  contact: "contactName",
  "contact name": "contactName",
  pastor: "contactName",
  "full name": "contactName",
  role: "role",
  title: "role",
  position: "role",
  email: "email",
  "email address": "email",
  "e-mail": "email",
  phone: "phone",
  "phone number": "phone",
  mobile: "phone",
  number: "phone",
  whatsapp: "whatsapp",
  "whatsapp number": "whatsapp",
  city: "city",
  town: "city",
  lga: "city",
  state: "state",
  region: "state",
  country: "country",
  denomination: "denomination",
  church_type: "denomination",
  "church type": "denomination",
  size: "size",
  members: "size",
  "member count": "size",
  congregation: "size",
  attendance: "size",
  source: "source",
  channel: "source",
  notes: "notes",
  note: "notes",
  comment: "notes",
  remarks: "notes",
};

/** Map one CSV header cell to a lead field, or null when we don't know it. */
export function headerToLeadField(header: string): LeadImportField | null {
  const key = header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return HEADER_ALIASES[key] ?? null;
}

export const LEAD_CSV_TEMPLATE_HEADERS = [
  "Church name",
  "Contact name",
  "Role",
  "Email",
  "Phone",
  "WhatsApp",
  "City",
  "State",
  "Denomination",
  "Size",
  "Source",
  "Notes",
];

/* ------------------------------------------------------------------ *
 * Small helpers shared by the pipeline UI
 * ------------------------------------------------------------------ */

/** A wa.me link for a Nigerian-style number, or null if it can't be made. */
export function whatsappLink(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const intl = digits.startsWith("0")
    ? `234${digits.slice(1)}`
    : digits.startsWith("234")
      ? digits
      : digits.length === 10
        ? `234${digits}`
        : digits;
  return intl.length >= 11 ? `https://wa.me/${intl}` : null;
}

/** "3 days overdue" / "due today" / "in 5 days", from a follow-up date. */
export function followUpLabel(
  date: Date | string | null | undefined,
  now: Date = new Date(),
): { text: string; overdue: boolean; dueToday: boolean } | null {
  if (!date) return null;
  const when = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(when.getTime())) return null;

  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(when) - startOf(now)) / 86_400_000);

  if (days === 0) return { text: "Due today", overdue: false, dueToday: true };
  if (days < 0)
    return {
      text: days === -1 ? "1 day overdue" : `${Math.abs(days)} days overdue`,
      overdue: true,
      dueToday: false,
    };
  return {
    text: days === 1 ? "Due tomorrow" : `Due in ${days} days`,
    overdue: false,
    dueToday: false,
  };
}
