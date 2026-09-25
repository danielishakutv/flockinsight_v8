/**
 * The vocabulary of the activity log — safe to import anywhere.
 *
 * Every audited action has a dotted key: `<module>.<thing>.<verb>`. The module
 * is the first segment, which is what lets the log be filtered by module
 * without a second column to keep in step.
 *
 * Keys are permanent. Rows written last year still carry theirs, so renaming
 * one rewrites history into something unreadable — add a new key instead.
 */

export type AuditSeverity = "info" | "notice" | "warning" | "critical";
export type AuditScope = "platform" | "church";

export type AuditModule = {
  key: string;
  label: string;
  /** Who is allowed to read rows from this module in a church's own log. */
  perm?: string;
};

/**
 * Modules, in the order they appear in the filter. `platform` is last because
 * a church never sees it.
 */
export const AUDIT_MODULES: AuditModule[] = [
  { key: "auth", label: "Sign-in & security" },
  { key: "members", label: "Members", perm: "members.view" },
  { key: "attendance", label: "Attendance", perm: "attendance.view" },
  { key: "groups", label: "Groups", perm: "groups.view" },
  { key: "giving", label: "Giving", perm: "giving.view" },
  { key: "finance", label: "Finance", perm: "finance.view" },
  { key: "followup", label: "Follow-up", perm: "followup.view" },
  { key: "training", label: "Training", perm: "training.view" },
  { key: "meetings", label: "Meetings", perm: "meetings.view" },
  { key: "communication", label: "Communication", perm: "communication.view" },
  { key: "devotionals", label: "Devotionals", perm: "devotionals.view" },
  { key: "forms", label: "Forms", perm: "forms.view" },
  { key: "media", label: "Media", perm: "media.view" },
  { key: "events", label: "Events" },
  { key: "reports", label: "Reports & exports" },
  { key: "settings", label: "Settings" },
  { key: "team", label: "Team & roles" },
  { key: "billing", label: "Billing & wallet" },
  { key: "platform", label: "Platform admin" },
];

export const AUDIT_MODULE_LABEL: Record<string, string> = Object.fromEntries(
  AUDIT_MODULES.map((m) => [m.key, m.label]),
);

/** The module a key belongs to — its first segment. */
export function moduleOf(action: string): string {
  const head = action.split(".")[0];
  return AUDIT_MODULE_LABEL[head] ? head : "platform";
}

/**
 * Verbs, with the severity they carry by default.
 *
 * Deletions and exports are `warning` not because they are wrong but because
 * they are the rows someone scanning a long log is looking for. Anything
 * touching access or money is `critical`.
 */
const VERB_SEVERITY: Record<string, AuditSeverity> = {
  create: "info",
  update: "info",
  view: "info",
  send: "notice",
  import: "notice",
  restore: "warning",
  export: "warning",
  download: "warning",
  delete: "warning",
  remove: "warning",
  archive: "notice",
  login: "info",
  logout: "info",
  failed: "warning",
  reset: "critical",
  impersonate: "critical",
  grant: "critical",
  revoke: "critical",
  suspend: "critical",
  purge: "critical",
};

export function severityFor(action: string): AuditSeverity {
  const verb = action.split(".").pop() ?? "";
  return VERB_SEVERITY[verb] ?? "info";
}

export const SEVERITY_LABEL: Record<AuditSeverity, string> = {
  info: "Routine",
  notice: "Worth knowing",
  warning: "Needs attention",
  critical: "Sensitive",
};

/** Tailwind classes, written out in full so the compiler keeps them. */
export const SEVERITY_TONE: Record<AuditSeverity, string> = {
  info: "bg-muted text-muted-foreground",
  notice: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  critical: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

/**
 * A readable label for a key we have no specific wording for. The summary on
 * the row is what people actually read; this is the little grey chip beside it,
 * and it must never be blank.
 */
export function describeAction(action: string): string {
  const parts = action.split(".");
  if (parts.length < 2) return sentence(action);
  const verb = parts[parts.length - 1];
  const thing = parts.slice(1, -1).join(" ") || AUDIT_MODULE_LABEL[parts[0]] || parts[0];
  return sentence(`${verb} ${thing}`);
}

function sentence(s: string): string {
  const t = s.replace(/[._-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Keys that must never reach the log, whatever a caller passes in `meta`.
 * Matched case-insensitively against the key name, anywhere in it.
 */
const SECRET_KEY_PATTERN =
  /pass|secret|token|key$|apikey|authorization|cookie|session|otp|pin|cvv|signature|credential/i;

/**
 * Strip anything that looks like a credential, and cap the size.
 *
 * An audit log is read by more people than the data it describes — that is the
 * point of it — so a password that lands here is a password shown to everyone
 * with the activity permission. The filter is deliberately blunt: a false
 * positive costs a redacted field, a false negative costs a leak.
 */
export function sanitiseMeta(
  meta: Record<string, unknown> | undefined | null,
  depth = 0,
): Record<string, unknown> {
  if (!meta || typeof meta !== "object") return {};
  const out: Record<string, unknown> = {};
  let count = 0;

  for (const [k, v] of Object.entries(meta)) {
    if (count >= 40) break;
    count++;
    if (SECRET_KEY_PATTERN.test(k)) {
      out[k] = "[redacted]";
      continue;
    }
    out[k] = sanitiseValue(v, depth);
  }
  return out;
}

function sanitiseValue(v: unknown, depth: number): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.length > 500 ? `${v.slice(0, 500)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) {
    if (depth >= 3) return `[${v.length} items]`;
    return v.slice(0, 30).map((x) => sanitiseValue(x, depth + 1));
  }
  if (typeof v === "object") {
    if (depth >= 3) return "[object]";
    return sanitiseMeta(v as Record<string, unknown>, depth + 1);
  }
  return String(v);
}

/**
 * Work out which fields changed between two versions of a record, so an
 * "updated" row can say what was actually updated instead of just "updated".
 * Values are kept — that is the whole value of the entry — minus anything the
 * secret filter catches.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields?: string[],
): Record<string, { from: unknown; to: unknown }> {
  const keys = fields ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) {
    if (SECRET_KEY_PATTERN.test(k)) continue;
    const a = normalise(before[k]);
    const b = normalise(after[k]);
    if (a === b) continue;
    changed[k] = {
      from: sanitiseValue(before[k], 1),
      to: sanitiseValue(after[k], 1),
    };
  }
  return changed;
}

/** Compare the way a person would: 5 and "5" are the same answer. */
function normalise(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** "3 fields" / "name and email" — the tail of an update summary. */
export function summariseChanges(
  changed: Record<string, unknown>,
  labels?: Record<string, string>,
): string {
  const names = Object.keys(changed).map((k) => labels?.[k] ?? humanField(k));
  if (names.length === 0) return "no changes";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length <= 4)
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.length} fields`;
}

function humanField(k: string): string {
  return k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .toLowerCase();
}
