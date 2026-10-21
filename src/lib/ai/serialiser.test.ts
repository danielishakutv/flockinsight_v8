import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCALES } from "@/lib/i18n/locales";
import {
  AiPayloadRejected,
  assertOnlyVocabulary,
  count,
  indexOf,
  pct,
  rate,
  revalidatePayload,
  serialise,
  type ChurchFacts,
  type Count,
} from "./serialiser";
import { LOCALE } from "./vocab";

const c = (n: number) => count(n);

function sampleChurchFacts(): ChurchFacts {
  return {
    meta: { locale: "en", period: "last_12_weeks", anchoredToOlderData: "no" },
    attendance: {
      weeklyTotals: [120, 130, 0, 140, 150, 160, 150, 170, 180, 175, 190, 200].map(c),
      weeklyAverage8: c(170),
      growthPct4: pct(110, 100),
      trend: "rising",
      weeksWithRecords: c(11),
      adultMenShare: rate(30, 100),
      adultWomenShare: rate(45, 100),
      teensShare: rate(10, 100),
      childrenShare: rate(15, 100),
      firstTimers12w: c(14),
      newConverts12w: c(3),
      serviceAverages: [140, 60].map(c),
    },
    people: {
      total: c(240),
      active: c(180),
      inactive: c(20),
      visitors: c(30),
      newConverts: c(10),
      registeredByMonth: [4, 6, 2, 8, 5, 7].map(c),
      phoneOnFileRate: rate(200, 240),
      emailOnFileRate: rate(90, 240),
    },
    firstTimers: {
      registered90d: c(25),
      becameMember90dRate: rate(5, 25),
      followUpNew: c(6),
      followUpContacted: c(4),
      followUpInProgress: c(3),
      followUpJoined: c(5),
      followUpNotInterested: c(2),
    },
    giving: {
      monthlyIndex: [100, 110, 95, 120, 130, 125].map((v) => indexOf(v, 100)),
      monthOverMonthPct: pct(125, 130),
      monthsWithRecords: c(6),
      trend: "rising",
    },
    engagement: {
      groups: c(8),
      openFollowUps: c(13),
      upcomingEvents: c(2),
      formResponses: c(40),
      devotionalSubscribers: c(55),
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("brand constructors", () => {
  it("count rejects negative, fractional, NaN, Infinity and over-range values", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10_000_001]) {
      expect(() => count(bad)).toThrow(RangeError);
    }
    expect(count(0)).toBe(0);
    expect(count(10_000_000)).toBe(10_000_000);
  });

  it("rate is null below the UI's minimum denominator of 10, and rounds and clamps", () => {
    expect(rate(3, 9)).toBeNull();
    expect(rate(3, 10)).toBe(0.3);
    expect(rate(1, 3 * 10)).toBe(0.03);
    expect(rate(15, 10)).toBe(1);
    expect(() => rate(Number.NaN, 10)).toThrow(RangeError);
  });

  it("pct is null when previous is 0, rounds, and clamps to ±999", () => {
    expect(pct(5, 0)).toBeNull();
    expect(pct(110, 100)).toBe(10);
    expect(pct(90, 100)).toBe(-10);
    expect(pct(100_000, 1)).toBe(999);
    expect(Object.is(pct(100, 100), 0)).toBe(true);
  });

  it("indexOf rounds to the nearest 5 and is null when base is 0", () => {
    expect(indexOf(123, 100)).toBe(125);
    expect(indexOf(122, 100)).toBe(120);
    expect(indexOf(50, 0)).toBeNull();
    expect(indexOf(1_000_000, 1)).toBe(10_000);
  });
});

describe("vocabulary", () => {
  it("LOCALE equals the codes of LOCALES", () => {
    expect([...LOCALE]).toEqual(LOCALES.map((l) => l.code));
  });
});

describe("serialise", () => {
  it("drops keys that are not on the allow-list and warns with their paths only", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const facts = sampleChurchFacts() as unknown as Record<string, Record<string, unknown>>;
    facts.people.firstName = "Adaeze Okafor";
    facts.secret = { phone: "08031234567" } as unknown as Record<string, unknown>;
    const out = serialise("church-facts@1", facts as unknown as ChurchFacts);
    expect(out.json).not.toContain("Adaeze");
    expect(out.json).not.toContain("08031234567");
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls[0]);
    expect(logged).toContain("$.people.firstName");
    expect(logged).toContain("$.secret");
    expect(logged).not.toContain("Adaeze");
    expect(logged).not.toContain("08031234567");
  });

  it("refuses a label outside its vocabulary without echoing the value", () => {
    const facts = sampleChurchFacts();
    (facts.attendance as unknown as Record<string, unknown>).trend = "08031234567";
    let err: unknown;
    try {
      serialise("church-facts@1", facts);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AiPayloadRejected);
    const msg = (err as Error).message;
    expect(msg).toContain("$.attendance.trend");
    expect(msg).not.toContain("08031234567");
  });

  it("refuses an out-of-range number smuggled past the brands", () => {
    const facts = sampleChurchFacts();
    (facts.people as unknown as Record<string, unknown>).total = -4;
    expect(() => serialise("church-facts@1", facts)).toThrow(AiPayloadRejected);
    const f2 = sampleChurchFacts();
    (f2.people as unknown as Record<string, unknown>).phoneOnFileRate = 0.123;
    expect(() => serialise("church-facts@1", f2)).toThrow(AiPayloadRejected);
    const f3 = sampleChurchFacts();
    f3.attendance.weeklyTotals = Array.from({ length: 13 }, () => 1 as Count);
    expect(() => serialise("church-facts@1", f3)).toThrow(AiPayloadRejected);
  });

  it("is byte-identical whatever order the input keys arrive in", () => {
    const a = sampleChurchFacts();
    const reversed = (o: unknown): unknown =>
      o && typeof o === "object" && !Array.isArray(o)
        ? Object.fromEntries(
            Object.entries(o as Record<string, unknown>)
              .reverse()
              .map(([k, v]) => [k, reversed(v)]),
          )
        : o;
    const b = reversed(a) as ChurchFacts;
    expect(serialise("church-facts@1", a).json).toBe(serialise("church-facts@1", b).json);
  });

  it("includes the schema id first", () => {
    const out = serialise("church-facts@1", sampleChurchFacts());
    expect(out.json.startsWith('{"schema":"church-facts@1",')).toBe(true);
    expect(out.schema).toBe("church-facts@1");
  });
});

describe("revalidatePayload", () => {
  it("accepts what serialise produced", () => {
    const p = serialise("church-facts@1", sampleChurchFacts());
    expect(revalidatePayload({ schema: p.schema, json: p.json }).json).toBe(p.json);
  });

  it("rejects an extra key, which serialise would only have warned about", () => {
    const p = serialise("church-facts@1", sampleChurchFacts());
    const obj = JSON.parse(p.json);
    obj.people.firstName = "Adaeze";
    expect(() => revalidatePayload({ schema: p.schema, json: JSON.stringify(obj) })).toThrow(AiPayloadRejected);
  });

  it("rejects a schema id that is not registered", () => {
    const p = serialise("church-facts@1", sampleChurchFacts());
    expect(() => revalidatePayload({ schema: "members@1", json: p.json })).toThrow(AiPayloadRejected);
  });

  it("rejects json that does not round-trip to the same bytes", () => {
    const p = serialise("church-facts@1", sampleChurchFacts());
    const pretty = JSON.stringify(JSON.parse(p.json), null, 2);
    expect(() => revalidatePayload({ schema: p.schema, json: pretty })).toThrow(AiPayloadRejected);
    expect(() => revalidatePayload({ schema: p.schema, json: "{not json" })).toThrow(AiPayloadRejected);
    expect(() => revalidatePayload("nope")).toThrow(AiPayloadRejected);
  });
});

describe("assertOnlyVocabulary", () => {
  it("accepts serialised output", () => {
    const p = serialise("church-facts@1", sampleChurchFacts());
    expect(() => assertOnlyVocabulary(p.json)).not.toThrow();
  });

  it("rejects any foreign string, as a key or a value", () => {
    expect(() => assertOnlyVocabulary(JSON.stringify({ schema: "church-facts@1", x: 1 }))).toThrow(AiPayloadRejected);
    expect(() => assertOnlyVocabulary(JSON.stringify({ schema: "Grace Chapel" }))).toThrow(AiPayloadRejected);
  });
});
