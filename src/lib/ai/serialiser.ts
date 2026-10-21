/**
 * THE allow-list: the only path by which database-derived figures reach a
 * model.
 *
 * A schema names every key that may leave and the kind of value it holds.
 * serialise() walks the SCHEMA's keys, never the input's, so a key that is not
 * on the list is never even read. Every value is re-checked at runtime too,
 * because the branded number types below are compile-time only and an `as any`
 * walks straight through them.
 *
 * Errors name the path and the expected kind, NEVER the value: the value that
 * failed may be exactly the phone number this file exists to keep out of the
 * logs.
 *
 * Pure (no server-only, no database), so vitest loads it directly.
 */

import { MIN_DENOMINATOR_FOR_PERCENT } from "@/lib/thin-data";
import {
  AREA,
  LOCALE,
  PERIOD,
  SCHEMA_IDS,
  TREND,
  YESNO,
  isSchemaId,
  type SchemaId,
} from "./vocab";

/* ------------------------------------------------------------------ *
 * Branded numbers. A plain number is not assignable to any of these, so
 * a fact builder has to go through a constructor that checks the range.
 * ------------------------------------------------------------------ */

export type Count = number & { readonly __ai: "count" };
export type Rate = number & { readonly __ai: "rate" };
export type Pct = number & { readonly __ai: "pct" };
export type Index = number & { readonly __ai: "index" };

export const MAX_COUNT = 10_000_000;
export const MAX_PCT = 999;
export const MAX_INDEX = 10_000;

/** A non-negative whole number up to ten million. Anything else is a builder bug. */
export function count(n: number): Count {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_COUNT) {
    throw new RangeError(
      `count() needs a whole number from 0 to ${MAX_COUNT}. Fix the fact builder that produced it.`,
    );
  }
  return n as Count;
}

/**
 * part/whole as 0..1, rounded to 2dp. Null when whole is below the same
 * minimum denominator the UI uses (lib/thin-data.ts), so the model never
 * quotes a percentage the page itself would refuse to show.
 */
export function rate(part: number, whole: number): Rate | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole)) {
    throw new RangeError("rate() needs two finite numbers. Fix the fact builder that produced them.");
  }
  if (whole < MIN_DENOMINATOR_FOR_PERCENT) return null;
  const r = Math.round((part / whole) * 100) / 100;
  return Math.min(1, Math.max(0, r)) as Rate;
}

/** Percentage change, rounded to a whole number and clamped to ±999. Null when previous is 0. */
export function pct(current: number, previous: number): Pct | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    throw new RangeError("pct() needs two finite numbers. Fix the fact builder that produced them.");
  }
  if (previous === 0) return null;
  const p = Math.round(((current - previous) / Math.abs(previous)) * 100);
  // `+ 0` turns -0 into 0 so the JSON bytes are the same either way.
  return (Math.min(MAX_PCT, Math.max(-MAX_PCT, p)) + 0) as Pct;
}

/**
 * value relative to base, where 100 = base. Rounded to the nearest 5: that is
 * the bucketing which keeps a small church's giving from being reverse-
 * engineered from the index. Null when base is 0.
 */
export function indexOf(value: number, base: number): Index | null {
  if (!Number.isFinite(value) || !Number.isFinite(base)) {
    throw new RangeError("indexOf() needs two finite numbers. Fix the fact builder that produced them.");
  }
  if (base === 0) return null;
  const i = Math.round(((value / base) * 100) / 5) * 5;
  return (Math.min(MAX_INDEX, Math.max(0, i)) + 0) as Index;
}

/* ------------------------------------------------------------------ *
 * The schema DSL
 * ------------------------------------------------------------------ */

type NumKind = "count" | "rate" | "pct" | "index";
type Vocab = readonly string[];

export type ScalarSpec = { readonly k: NumKind; readonly nullable?: true };
export type LabelSpec = { readonly k: "label"; readonly vocab: Vocab; readonly nullable?: true };
export type LabelsSpec = { readonly k: "labels"; readonly vocab: Vocab; readonly max: number };
export type SeriesSpec = {
  readonly k: "series";
  readonly of: "count" | "index" | "pct";
  readonly max: number;
  /** Index and pct series may hold nulls (a month with no base); count series never do. */
  readonly nullableItems?: true;
};
export type GroupSpec = { readonly k: "group"; readonly fields: { readonly [key: string]: Kind } };
export type Kind = ScalarSpec | LabelSpec | LabelsSpec | SeriesSpec | GroupSpec;

const num = <K extends NumKind>(k: K) => ({ k }) as const;
const opt = <K extends NumKind>(k: K) => ({ k, nullable: true }) as const;
const label = <V extends Vocab>(vocab: V) => ({ k: "label", vocab }) as const;
const labels = <V extends Vocab>(vocab: V, max: number) =>
  ({ k: "labels", vocab, max }) as const;
const series = (of: "count", max: number) => ({ k: "series", of, max }) as const;
const nullableSeries = <O extends "index" | "pct">(of: O, max: number) =>
  ({ k: "series", of, max, nullableItems: true }) as const;
const group = <F extends { readonly [key: string]: Kind }>(fields: F) =>
  ({ k: "group", fields }) as const;

type Brand<K extends NumKind> = K extends "count"
  ? Count
  : K extends "rate"
    ? Rate
    : K extends "pct"
      ? Pct
      : Index;

/** The input type a schema accepts, derived from it, so the compiler checks every builder. */
export type FactsOf<S> = S extends { k: "group"; fields: infer F }
  ? { [P in keyof F]: FactsOf<F[P]> }
  : S extends { k: "series"; of: infer O extends NumKind; nullableItems: true }
    ? (Brand<O> | null)[]
    : S extends { k: "series"; of: infer O extends NumKind }
      ? Brand<O>[]
      : S extends { k: "labels"; vocab: infer V extends Vocab }
        ? V[number][]
        : S extends { k: "label"; vocab: infer V extends Vocab; nullable: true }
          ? V[number] | null
          : S extends { k: "label"; vocab: infer V extends Vocab }
            ? V[number]
            : S extends { k: infer K extends NumKind; nullable: true }
              ? Brand<K> | null
              : S extends { k: infer K extends NumKind }
                ? Brand<K>
                : never;

/* ------------------------------------------------------------------ *
 * The schemas. One-dimensional marginal totals only: there is no
 * cross-tabulation (gender x age x status), so no cell can narrow
 * down to a person.
 * ------------------------------------------------------------------ */

export const CHURCH_FACTS_V1 = group({
  meta: group({
    locale: label(LOCALE),
    period: label(PERIOD),
    anchoredToOlderData: label(YESNO),
  }),
  attendance: group({
    weeklyTotals: series("count", 12),
    weeklyAverage8: num("count"),
    growthPct4: opt("pct"),
    trend: label(TREND),
    weeksWithRecords: num("count"),
    adultMenShare: opt("rate"),
    adultWomenShare: opt("rate"),
    teensShare: opt("rate"),
    childrenShare: opt("rate"),
    firstTimers12w: num("count"),
    newConverts12w: num("count"),
    // Positional and sorted descending. No service names: a church types its own.
    serviceAverages: series("count", 8),
  }),
  people: group({
    total: num("count"),
    active: num("count"),
    inactive: num("count"),
    visitors: num("count"),
    newConverts: num("count"),
    registeredByMonth: series("count", 6),
    phoneOnFileRate: opt("rate"),
    emailOnFileRate: opt("rate"),
  }),
  firstTimers: group({
    registered90d: num("count"),
    becameMember90dRate: opt("rate"),
    followUpNew: num("count"),
    followUpContacted: num("count"),
    followUpInProgress: num("count"),
    followUpJoined: num("count"),
    followUpNotInterested: num("count"),
  }),
  // No amounts, no currency, no category names.
  giving: group({
    monthlyIndex: nullableSeries("index", 6),
    monthOverMonthPct: opt("pct"),
    monthsWithRecords: num("count"),
    trend: label(TREND),
  }),
  engagement: group({
    groups: num("count"),
    openFollowUps: num("count"),
    upcomingEvents: num("count"),
    formResponses: num("count"),
    devotionalSubscribers: num("count"),
  }),
});

export const PLATFORM_FACTS_V1 = group({
  meta: group({ period: label(PERIOD) }),
  churches: group({
    total: num("count"),
    active30: num("count"),
    atRisk: num("count"),
    neverActivated: num("count"),
    signups30d: num("count"),
    signupsPrev30d: num("count"),
    byPlan: group({
      starter: num("count"),
      growth: num("count"),
      pro: num("count"),
      enterprise: num("count"),
    }),
  }),
  growth: group({
    weeklySignups: series("count", 13),
    weeklyActiveChurches: series("count", 13),
  }),
  // Percentages only: no revenue figure ever leaves.
  revenue: group({
    mrrChangePct: opt("pct"),
    revenueMonthChangePct: opt("pct"),
    revenueAtRiskShare: opt("rate"),
  }),
  usage: group({
    dau: num("count"),
    wau: num("count"),
    mau: num("count"),
    activeChurches7: num("count"),
    topAreas: labels(AREA, 5),
  }),
});

export type ChurchFacts = FactsOf<typeof CHURCH_FACTS_V1>;
export type PlatformFacts = FactsOf<typeof PLATFORM_FACTS_V1>;

export const SCHEMAS: Readonly<Record<SchemaId, GroupSpec>> = Object.freeze({
  "church-facts@1": CHURCH_FACTS_V1,
  "platform-facts@1": PLATFORM_FACTS_V1,
});

type FactsFor = {
  "church-facts@1": ChurchFacts;
  "platform-facts@1": PlatformFacts;
};

/* ------------------------------------------------------------------ *
 * The payload
 * ------------------------------------------------------------------ */

/**
 * What runAi accepts as church data. The brand is for the compiler only;
 * runAi re-validates the json against SCHEMAS[schema] before sending, so
 * nothing depends on this object having come from this module instance.
 */
export type SafePayload = {
  readonly schema: SchemaId;
  readonly json: string;
} & { readonly __safePayload: true };

/** A value failed the allow-list. Message: the path and the kind, never the value. */
export class AiPayloadRejected extends Error {
  readonly path: string;
  readonly expected: string;
  constructor(path: string, expected: string) {
    super(
      `AI payload rejected at ${path}: expected ${expected}. Nothing was sent. Fix the fact builder for this path.`,
    );
    this.name = "AiPayloadRejected";
    this.path = path;
    this.expected = expected;
  }
}

function checkNumber(v: unknown, kind: NumKind | "series-item", of: NumKind, path: string): number {
  const expected = kind === "series-item" ? `${of} (series item)` : of;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new AiPayloadRejected(path, expected);
  switch (of) {
    case "count":
      if (!Number.isInteger(v) || v < 0 || v > MAX_COUNT) throw new AiPayloadRejected(path, expected);
      break;
    case "rate":
      if (v < 0 || v > 1 || Math.round(v * 100) / 100 !== v) throw new AiPayloadRejected(path, expected);
      break;
    case "pct":
      if (!Number.isInteger(v) || v < -MAX_PCT || v > MAX_PCT) throw new AiPayloadRejected(path, expected);
      break;
    case "index":
      if (!Number.isInteger(v) || v < 0 || v > MAX_INDEX || v % 5 !== 0)
        throw new AiPayloadRejected(path, expected);
      break;
  }
  return v + 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Walk `spec` over `input`, returning a NEW value built in schema key order.
 * Extra input keys are collected into `extras` (paths only); in strict mode
 * they are an error instead.
 */
function walk(spec: Kind, input: unknown, path: string, extras: string[], strict: boolean): unknown {
  switch (spec.k) {
    case "group": {
      if (!isPlainObject(input)) throw new AiPayloadRejected(path, "group");
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(spec.fields)) {
        if (!Object.prototype.hasOwnProperty.call(input, key)) {
          throw new AiPayloadRejected(`${path}.${key}`, "a value (the key is missing)");
        }
        out[key] = walk(spec.fields[key], input[key], `${path}.${key}`, extras, strict);
      }
      for (const key of Object.keys(input)) {
        if (!Object.prototype.hasOwnProperty.call(spec.fields, key)) {
          if (strict) throw new AiPayloadRejected(`${path}.${key}`, "no such key on the allow-list");
          extras.push(`${path}.${key}`);
        }
      }
      return out;
    }
    case "label": {
      if (input === null && spec.nullable) return null;
      if (typeof input !== "string" || !spec.vocab.includes(input)) {
        throw new AiPayloadRejected(path, "label from its vocabulary");
      }
      return input;
    }
    case "labels": {
      if (!Array.isArray(input) || input.length > spec.max) {
        throw new AiPayloadRejected(path, `list of at most ${spec.max} labels`);
      }
      return input.map((v, i) => {
        if (typeof v !== "string" || !spec.vocab.includes(v)) {
          throw new AiPayloadRejected(`${path}[${i}]`, "label from its vocabulary");
        }
        return v;
      });
    }
    case "series": {
      if (!Array.isArray(input) || input.length > spec.max) {
        throw new AiPayloadRejected(path, `series of at most ${spec.max} ${spec.of} values`);
      }
      return input.map((v, i) => {
        if (v === null && spec.nullableItems) return null;
        return checkNumber(v, "series-item", spec.of, `${path}[${i}]`);
      });
    }
    default: {
      if (input === null && spec.nullable) return null;
      return checkNumber(input, spec.k, spec.k, path);
    }
  }
}

function stringifyPayload(schemaId: SchemaId, body: unknown): string {
  // `schema` first, then the schema's own key order: deterministic bytes, so
  // the sha256 of two identical days is identical.
  return JSON.stringify({ schema: schemaId, ...(body as Record<string, unknown>) });
}

/**
 * Build the payload for one schema. Throws AiPayloadRejected on any value
 * outside the allow-list, so a run fails closed and nothing is sent.
 */
export function serialise<S extends SchemaId>(schemaId: S, facts: FactsFor[S]): SafePayload {
  const spec = SCHEMAS[schemaId];
  if (!spec) throw new AiPayloadRejected("$", "a registered schema id");
  const extras: string[] = [];
  const body = walk(spec, facts, "$", extras, false);
  if (extras.length > 0) {
    // Paths only, never values: a builder mistake is visible, not silent.
    console.warn("[ai] dropped non-allow-listed keys", extras);
  }
  return Object.freeze({ schema: schemaId as SchemaId, json: stringifyPayload(schemaId, body) }) as SafePayload;
}

/**
 * The enforcement that does not depend on module identity. Whatever object
 * arrives, its json is parsed, walked in STRICT mode (an extra key is an
 * error here, not a warning), re-stringified, and must come back byte for
 * byte. runAi calls this on every payload immediately before sending.
 */
export function revalidatePayload(p: unknown): SafePayload {
  if (!isPlainObject(p)) throw new AiPayloadRejected("$", "a payload object");
  const schemaId = p.schema;
  if (!isSchemaId(schemaId)) throw new AiPayloadRejected("$.schema", "a registered schema id");
  if (typeof p.json !== "string") throw new AiPayloadRejected("$.json", "a JSON string");
  let parsed: unknown;
  try {
    parsed = JSON.parse(p.json);
  } catch {
    // The parse error text can quote the input, so it is not passed on.
    throw new AiPayloadRejected("$.json", "valid JSON");
  }
  if (!isPlainObject(parsed) || parsed.schema !== schemaId) {
    throw new AiPayloadRejected("$.schema", `"${schemaId}" inside the json`);
  }
  const { schema: _schema, ...rest } = parsed;
  void _schema;
  const body = walk(SCHEMAS[schemaId], rest, "$", [], true);
  const again = stringifyPayload(schemaId, body);
  if (again !== p.json) throw new AiPayloadRejected("$.json", "the canonical serialisation");
  return Object.freeze({ schema: schemaId, json: again }) as SafePayload;
}

/** Every string a schema can legitimately emit: its keys and its vocabularies. */
function collectStrings(spec: Kind, out: Set<string>): void {
  if (spec.k === "group") {
    for (const [key, child] of Object.entries(spec.fields)) {
      out.add(key);
      collectStrings(child, out);
    }
  } else if (spec.k === "label" || spec.k === "labels") {
    for (const w of spec.vocab) out.add(w);
  }
}

export function allowedStrings(): Set<string> {
  const out = new Set<string>(["schema", ...SCHEMA_IDS]);
  for (const spec of Object.values(SCHEMAS)) collectStrings(spec, out);
  return out;
}

/**
 * A second, schema-blind net: every string anywhere in the json (keys and
 * values) must be a schema key, a vocabulary word or a schema id.
 */
export function assertOnlyVocabulary(json: string): void {
  const allowed = allowedStrings();
  const visit = (v: unknown, path: string) => {
    if (typeof v === "string") {
      if (!allowed.has(v)) throw new AiPayloadRejected(path, "a vocabulary word");
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, `${path}[${i}]`));
    } else if (isPlainObject(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (!allowed.has(k)) throw new AiPayloadRejected(`${path}.<key>`, "an allow-listed key");
        visit(x, `${path}.${k}`);
      }
    }
  };
  visit(JSON.parse(json), "$");
}
