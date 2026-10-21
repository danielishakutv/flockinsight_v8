/**
 * What a cron run DID, kept small enough to sit on its heartbeat row.
 *
 * A heartbeat says a job ran and how long it took. For most of these jobs
 * that is six milliseconds, which the health page rendered as "took 0.0s" —
 * and "ran in no time, every time" is indistinguishable from "ran and did
 * nothing", which is indistinguishable from "is broken". Every route already
 * answers with a JSON summary ({ churchesChecked: 2, sms: 0, ... }); it was
 * simply thrown away. `withCronRun` now keeps a compact copy on the row, and
 * the health page prints it, so "0 greetings due in 2 churches" is a sentence
 * rather than a suspicion.
 *
 * Pure, so the shaping can be tested without a database or a Response.
 */

const MAX_STRING = 120;
const MAX_ENTRIES = 24;
const MAX_JSON = 4000;

/**
 * Keys that never belong on a heartbeat row, whatever a route puts in its
 * reply. The health page prints this to platform admins, and a cron that one
 * day answers "who was emailed" must not turn that page into a list of
 * addresses — or a secret into a log line. Today no route sends any of these;
 * this is the fence, not a repair.
 */
const NEVER_STORED = /password|secret|token|e-?mail|phone|address|recipient|member|user/i;

export type CronMeta = Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isScalar(v: unknown): boolean {
  return (
    v === null ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    typeof v === "string"
  );
}

/**
 * Shrink a route's JSON reply to what a row can carry: scalars, short
 * strings, one level of nested objects, and the LENGTH of any list rather
 * than the list — a dry run's "who would hear from us" can be hundreds of
 * entries, and it belongs in the response, not in a heartbeat.
 *
 * `ok` is dropped because the row has its own `ok` column, and nothing at all
 * is kept from a body that is not an object. Null means "nothing to say".
 */
export function compactMeta(body: unknown): CronMeta | null {
  if (!isRecord(body)) return null;

  const out: CronMeta = {};
  let n = 0;
  for (const [key, value] of Object.entries(body)) {
    if (key === "ok") continue;
    if (n >= MAX_ENTRIES) break;
    const c = compactValue(key, value, 0);
    if (c === undefined) continue;
    out[key] = c;
    n++;
  }
  if (n === 0) return null;

  if (JSON.stringify(out).length > MAX_JSON) {
    // Still too big: the scalars alone, then.
    const slim: CronMeta = {};
    for (const [key, value] of Object.entries(out)) {
      if (isScalar(value)) slim[key] = value;
    }
    return Object.keys(slim).length > 0 ? slim : null;
  }
  return out;
}

function compactValue(key: string, v: unknown, depth: number): unknown {
  if (v === null) return null;
  // A number under a fenced key is a count, and a count is fine ("3 emails").
  // Anything with content under one is not.
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (NEVER_STORED.test(key)) return Array.isArray(v) ? { count: v.length } : undefined;
  if (typeof v === "string") {
    return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING - 1)}…` : v;
  }
  if (Array.isArray(v)) {
    if (v.length <= 10 && v.every(isScalar)) {
      return v.map((x) => compactValue(key, x, depth + 1));
    }
    return { count: v.length };
  }
  if (isRecord(v)) {
    if (depth >= 1) return undefined;
    const out: CronMeta = {};
    let n = 0;
    for (const [inner, value] of Object.entries(v)) {
      if (n >= MAX_ENTRIES) break;
      const c = compactValue(inner, value, depth + 1);
      if (c === undefined) continue;
      out[inner] = c;
      n++;
    }
    return n > 0 ? out : undefined;
  }
  // Functions, symbols, bigints, undefined: not for a row.
  return undefined;
}

/** `churchesChecked` → "churches checked"; `sms_sent` → "sms sent". */
export function words(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

/**
 * One line for a person: "2 churches checked · 0 emails · 0 sms · 0 failed".
 *
 * Numbers lead ("0 sms", not "sms 0") because that is how the question is
 * asked — how many went? — and a zero is an answer, not noise: it is the
 * difference between "nobody had a birthday" and "the job never looked".
 * Top-level values first, then one level of nesting with its parent's name
 * in front, so a reminders run reads "… · 0 pledges reminders".
 */
export function describeMeta(
  meta: CronMeta | null | undefined,
  limit = 10,
): string {
  if (!meta) return "";
  const parts: string[] = [];
  let dropped = 0;

  const push = (label: string, v: unknown) => {
    let text: string | null = null;
    if (typeof v === "number") text = `${v} ${label}`;
    else if (typeof v === "boolean") text = `${label}: ${v ? "yes" : "no"}`;
    else if (typeof v === "string" && v !== "") text = `${label}: ${v}`;
    else if (Array.isArray(v) && v.length > 0) text = `${label}: ${v.join(", ")}`;
    if (text === null) return;
    if (parts.length >= limit) dropped++;
    else parts.push(text);
  };

  for (const [key, value] of Object.entries(meta)) {
    if (!isRecord(value)) push(words(key), value);
  }
  for (const [key, value] of Object.entries(meta)) {
    if (!isRecord(value)) continue;
    const keys = Object.keys(value);
    // A list that was replaced by its length reads as "3 results", not
    // "3 results count".
    if (keys.length === 1 && keys[0] === "count" && typeof value.count === "number") {
      push(words(key), value.count);
      continue;
    }
    for (const [inner, v] of Object.entries(value)) {
      push(`${words(key)} ${words(inner)}`, v);
    }
  }

  if (parts.length === 0) return "";
  return dropped > 0 ? `${parts.join(" · ")} · +${dropped} more` : parts.join(" · ");
}
