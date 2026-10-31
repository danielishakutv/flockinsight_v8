import { describe, expect, it, vi } from "vitest";
import { getTableColumns, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import {
  AiPayloadRejected,
  SCHEMAS,
  allowedStrings,
  count,
  indexOf,
  pct,
  rate,
  serialise,
  type Kind,
} from "./serialiser";
import { toPlatformFacts } from "./platform-facts-shared";
import { toFinanceFacts } from "./finance-facts-shared";
import { buildCostReport } from "@/lib/cost-to-serve-shared";
import { SCHEMA_IDS, type SchemaId } from "./vocab";

/*
 * The fixture test the spec asks for: walk the REAL database schema, collect
 * every column that could identify a person or a church, give each a
 * realistic value, and prove none of them can get through either payload
 * schema, whether injected as an extra key or substituted into a real slot.
 */

const IDENTIFYING_WORDS = new Set([
  "name",
  "phone",
  "email",
  "address",
  "street",
  "city",
  "note",
  "comment",
  "prayer",
  "request",
  "message",
  "body",
  "dob",
  "slug",
  "token",
  "ip",
  "url",
]);

function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

/** Which identifying category a column name falls in, on camelCase word boundaries. */
function category(key: string): string | null {
  const ws = words(key);
  if (ws.length === 0) return null;
  if (ws[ws.length - 1] === "id") return "id";
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i].replace(/s$/, "");
    if (IDENTIFYING_WORDS.has(w)) return w;
    if (w.startsWith("birth")) return "birth";
    if (w === "user" && ws[i + 1] === "agent") return "userAgent";
  }
  return null;
}

const FIXTURE_VALUE: Record<string, string> = {
  name: "Adaeze Okafor",
  phone: "+2348031234567",
  email: "pastor@example.org",
  address: "12 Allen Avenue",
  street: "Allen Avenue",
  city: "Ikeja",
  note: "Please pray for my sister's surgery",
  comment: "Called on Tuesday, will visit",
  prayer: "Healing for Mama Ngozi",
  request: "Pick-up from Ojota bus stop",
  message: "Welcome Chinedu, see you Sunday",
  body: "Dear Brother Emeka, thank you",
  birth: "1987-04-12",
  dob: "1987-04-12",
  slug: "grace-chapel-ikeja",
  token: "tok_9f8e7d6c5b4a3210",
  ip: "102.89.34.12",
  url: "https://example.org/p?id=7",
  userAgent: "Mozilla/5.0 (Linux; Android 13)",
  id: "6f1c2b8e-3d4a-4e5f-9a7b-1c2d3e4f5a6b",
};

function identifyingColumns(): string[] {
  const out = new Set<string>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    for (const key of Object.keys(getTableColumns(value))) {
      if (category(key)) out.add(key);
    }
  }
  return [...out];
}

const COLUMNS = identifyingColumns();
const FIXTURE: Record<string, string> = Object.fromEntries(
  COLUMNS.map((k) => [k, FIXTURE_VALUE[category(k) as string]]),
);
const VALUES = [...new Set(Object.values(FIXTURE))];

const c = (n: number) => count(n);

function churchFacts() {
  return {
    meta: { locale: "fr", period: "last_12_weeks", anchoredToOlderData: "yes" },
    attendance: {
      weeklyTotals: [10, 20, 30].map(c),
      weeklyAverage8: c(20),
      growthPct4: null,
      trend: "steady",
      weeksWithRecords: c(3),
      adultMenShare: rate(4, 10),
      adultWomenShare: rate(4, 10),
      teensShare: null,
      childrenShare: rate(2, 10),
      firstTimers12w: c(1),
      newConverts12w: c(0),
      serviceAverages: [c(20)],
    },
    people: {
      total: c(30),
      active: c(20),
      inactive: c(5),
      visitors: c(5),
      newConverts: c(0),
      registeredByMonth: [1, 2, 3, 4, 5, 6].map(c),
      phoneOnFileRate: rate(20, 30),
      emailOnFileRate: null,
    },
    firstTimers: {
      registered90d: c(2),
      becameMember90dRate: null,
      followUpNew: c(1),
      followUpContacted: c(1),
      followUpInProgress: c(0),
      followUpJoined: c(0),
      followUpNotInterested: c(0),
    },
    giving: {
      monthlyIndex: [indexOf(1, 1), null],
      monthOverMonthPct: pct(2, 1),
      monthsWithRecords: c(1),
      trend: "not_enough_data",
    },
    engagement: {
      groups: c(1),
      openFollowUps: c(1),
      upcomingEvents: c(0),
      formResponses: c(0),
      devotionalSubscribers: c(0),
    },
  };
}

function platformFacts() {
  return toPlatformFacts({
    overview: {
      totalChurches: 14,
      activeChurches: 9,
      atRisk: 2,
      neverActivated: 3,
      mrrDeltaPct: 12,
      revenueMonthDeltaPct: -4,
      revenueAtRisk: 20_000,
      mrr: 300_000,
    },
    growth: Array.from({ length: 90 }, (_, i) => ({ day: `d${i}`, signups: i % 3, activeChurches: 5 })),
    usage: { dau: 4, wau: 12, mau: 30, activeChurches7: 8, topFeatures: [{ name: "Members" }] },
    planMix: [{ plan: "growth", n: 6 }],
  });
}

function financeFacts() {
  const report = buildCostReport({
    months: ["2026-08", "2026-09", "2026-10"],
    currentMonth: null,
    churches: [
      { id: "c1", name: "Adaeze Okafor Chapel", planKey: "growth", planLabel: "Growth", joined: "2026-01", onTrial: false, channel: "instagram", members: 80, storageBytes: 1e8 },
      { id: "c2", name: "Grace Assembly", planKey: "starter", planLabel: "Starter", joined: "2026-02", onTrial: true, channel: "direct", members: 30, storageBytes: 0 },
    ],
    items: [
      { id: "i1", name: "Contabo VPS", category: "hosting", amountNgn: 30_000, foreign: true, frequency: "monthly", startsOn: "2026-01-01", endsOn: null, spreadMonths: null, driver: "active_churches", channel: null },
      { id: "i2", name: "Instagram ads", category: "marketing", amountNgn: 20_000, foreign: false, frequency: "monthly", startsOn: "2026-01-01", endsOn: null, spreadMonths: null, driver: "none", channel: "instagram" },
    ],
    payments: [{ churchId: "c1", paidAt: new Date("2026-08-02T10:00:00Z"), amount: 60_000, periodMonths: 3, gateway: "paystack", fee: null, international: false }],
    topups: [],
    walletSpend: [{ churchId: "c1", month: "2026-09", category: "sms", amount: 4_000 }],
    creditsGiven: [],
    partnerCommission: [],
    income: [],
    usage: [{ churchId: "c1", month: "2026-09", smsPages: 1000, emails: 20, meetingGb: 0, active: true }],
    ai: [],
    smsUnitCost: 2.5,
    smsPrice: 4,
    termiiMeasured: [{ month: "2026-09", spent: 2_800 }],
    ngnPerUsd: 1500,
  });
  return toFinanceFacts(report, report.series, 30_000);
}

const FACTS: Record<SchemaId, () => unknown> = {
  "church-facts@1": churchFacts,
  "platform-facts@1": platformFacts,
  "finance-facts@1": financeFacts,
};

type Slot = { path: string[]; kind: Kind };

/** Every leaf position, and every element position inside a series or labels list. */
function slots(spec: Kind, path: string[] = []): Slot[] {
  if (spec.k === "group") {
    return Object.entries(spec.fields).flatMap(([k, child]) => slots(child, [...path, k]));
  }
  return [{ path, kind: spec }];
}

function groups(spec: Kind, path: string[] = []): string[][] {
  if (spec.k !== "group") return [];
  return [path, ...Object.entries(spec.fields).flatMap(([k, child]) => groups(child, [...path, k]))];
}

function at(obj: unknown, path: string[]): Record<string, unknown> {
  let node = obj as Record<string, unknown>;
  for (const p of path) node = node[p] as Record<string, unknown>;
  return node;
}

describe("the allow-list against the real schema", () => {
  it("finds a non-trivial number of identifying columns, so the walk is real", () => {
    expect(COLUMNS.length).toBeGreaterThan(40);
    for (const v of VALUES) expect(typeof v).toBe("string");
  });

  for (const schemaId of SCHEMA_IDS) {
    const spec = SCHEMAS[schemaId];

    it(`${schemaId}: injected identifying fields never reach the output`, () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const facts = structuredClone(FACTS[schemaId]());
      for (const g of groups(spec)) Object.assign(at(facts, g), FIXTURE);
      const out = serialise(schemaId, facts as never);
      for (const v of VALUES) expect(out.json).not.toContain(v);
      // Paths were logged, values were not.
      const logged = JSON.stringify(warn.mock.calls);
      for (const v of VALUES) expect(logged).not.toContain(v);
      warn.mockRestore();
    });

    it(`${schemaId}: an identifying value in any real slot is refused`, () => {
      for (const slot of slots(spec)) {
        for (const v of VALUES) {
          const facts = structuredClone(FACTS[schemaId]());
          const parent = at(facts, slot.path.slice(0, -1));
          const key = slot.path[slot.path.length - 1];
          const isList = slot.kind.k === "series" || slot.kind.k === "labels";
          parent[key] = isList ? [v] : v;
          expect(() => serialise(schemaId, facts as never), `${slot.path.join(".")}`).toThrow(AiPayloadRejected);
        }
      }
    });

    it(`${schemaId}: no schema key is, or contains, an identifying column name`, () => {
      // Named after a column but holding a 0–1 rate of how many records have
      // one, never a value from it. Their kind is pinned below.
      const RATE_KEYS = new Set(["phoneOnFileRate", "emailOnFileRate"]);
      const keys = slots(spec).map((s) => s.path[s.path.length - 1]);
      const columnSet = new Set(COLUMNS);
      for (const key of [...keys, ...groups(spec).map((g) => g[g.length - 1]).filter(Boolean)]) {
        expect(columnSet.has(key), key).toBe(false);
        if (RATE_KEYS.has(key)) continue;
        expect(category(key), key).toBeNull();
      }
      for (const s of slots(spec)) {
        if (RATE_KEYS.has(s.path[s.path.length - 1])) expect(s.kind.k).toBe("rate");
      }
    });

    it(`${schemaId}: every string in the output is a key, a vocabulary word or a schema id`, () => {
      const out = serialise(schemaId, FACTS[schemaId]() as never);
      const allowed = allowedStrings();
      const visit = (v: unknown) => {
        if (typeof v === "string") expect(allowed.has(v), v).toBe(true);
        else if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === "object")
          for (const [k, x] of Object.entries(v)) {
            expect(allowed.has(k), k).toBe(true);
            visit(x);
          }
      };
      visit(JSON.parse(out.json));
    });
  }
});
