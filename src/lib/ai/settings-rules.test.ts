import { describe, expect, it } from "vitest";
import {
  ADVISOR_PILOT_DEFAULT,
  ADVISOR_ROLLOUT_DEFAULT,
  AI_CHURCH_SHARE_BY_PLAN_DEFAULT_USD,
  AI_CHURCH_SHARE_MAX_USD,
  ALLOWANCE_MAX,
  ASSISTANT_ALLOWANCE_DEFAULTS,
  churchShareUsdFor,
  normaliseAdvisorPilot,
  normaliseChurchShareByPlan,
  parseAdvisorPilot,
  parseAdvisorRollout,
  parseAssistantAllowances,
  parseChurchShareByPlan,
  validateAssistantAllowances,
} from "./settings-rules";

/*
 * Every value in platform_setting is a string somebody can get wrong. These
 * pin what each one means when it is wrong: never "unlimited", never "every
 * church", never a half-read mix of the setting and the defaults.
 */

describe("the church's monthly AI money, by plan", () => {
  it("falls back to the defaults as a whole for anything unreadable", () => {
    for (const raw of ["", "  ", "nope", "[]", "null", '{"starter":1}', '{"starter":"1","growth":1,"pro":1,"enterprise":1}']) {
      const r = parseChurchShareByPlan(raw);
      expect(r.ok, raw).toBe(false);
      expect(r.value).toEqual(AI_CHURCH_SHARE_BY_PLAN_DEFAULT_USD);
    }
  });

  it("reads a full setting, clamped to the hard stop and rounded to cents", () => {
    const r = parseChurchShareByPlan('{"starter":0.333,"growth":-2,"pro":2.5,"enterprise":999}');
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ starter: 0.33, growth: 0, pro: 2.5, enterprise: AI_CHURCH_SHARE_MAX_USD });
  });

  it("gives a church its plan's share, and an unknown plan the smallest", () => {
    const byPlan = { starter: 0.25, growth: 1, pro: 2.5, enterprise: 5 };
    expect(churchShareUsdFor("growth", byPlan)).toBe(1);
    expect(churchShareUsdFor("enterprise", byPlan)).toBe(5);
    expect(churchShareUsdFor("something-new", byPlan)).toBe(0.25);
    expect(churchShareUsdFor(null, byPlan)).toBe(0.25);
  });

  it("cleans an admin's input with every plan present", () => {
    expect(normaliseChurchShareByPlan({ growth: 7, pro: 1.234 })).toEqual({
      starter: AI_CHURCH_SHARE_BY_PLAN_DEFAULT_USD.starter,
      growth: AI_CHURCH_SHARE_MAX_USD,
      pro: 1.23,
      enterprise: AI_CHURCH_SHARE_BY_PLAN_DEFAULT_USD.enterprise,
    });
  });
});

describe("the question allowances", () => {
  const full = { starter: 10, growth: 20, pro: 30, enterprise: null, perPersonDaily: 5 };

  it("reads a full override, null meaning no ceiling on a plan", () => {
    const r = parseAssistantAllowances(JSON.stringify(full));
    expect(r).toEqual({ ok: true, value: full });
  });

  it("lands on the advertised numbers, never on unlimited, when it cannot be read", () => {
    const bad = [
      "",
      "not json",
      "[]",
      JSON.stringify({ ...full, starter: undefined }),
      JSON.stringify({ ...full, perPersonDaily: null }),
      JSON.stringify({ ...full, growth: 1.5 }),
      JSON.stringify({ ...full, pro: -1 }),
      JSON.stringify({ ...full, pro: ALLOWANCE_MAX + 1 }),
      JSON.stringify({ ...full, pro: "30" }),
    ];
    for (const raw of bad) {
      const r = parseAssistantAllowances(raw);
      expect(r.ok, raw).toBe(false);
      expect(r.value).toEqual(ASSISTANT_ALLOWANCE_DEFAULTS);
      expect(r.value.starter).toBe(30);
    }
  });

  it("validates an admin's input by the same rules it is read back with", () => {
    expect(validateAssistantAllowances(full)).toEqual(full);
    expect(validateAssistantAllowances({ ...full, perPersonDaily: 0.5 })).toBeNull();
    expect(validateAssistantAllowances(null)).toBeNull();
  });
});

describe("the church advisor's rollout", () => {
  it("defaults to the pilot, with the owner's own church in it", () => {
    expect(ADVISOR_ROLLOUT_DEFAULT).toBe("pilot");
    expect(ADVISOR_PILOT_DEFAULT).toEqual(["flockinsight-church"]);
  });

  it("counts only the three exact words, and anything else is off", () => {
    expect(parseAdvisorRollout("off")).toEqual({ value: "off", ok: true });
    expect(parseAdvisorRollout("pilot")).toEqual({ value: "pilot", ok: true });
    expect(parseAdvisorRollout(" all ")).toEqual({ value: "all", ok: true });
    for (const raw of ["ALL", "everyone", "", "true"]) {
      expect(parseAdvisorRollout(raw)).toEqual({ value: "off", ok: false });
    }
  });

  it("reads an unreadable pilot list as no pilot churches", () => {
    expect(parseAdvisorPilot('["grace-chapel","grace-chapel","rccg-1"]')).toEqual({
      value: ["grace-chapel", "rccg-1"],
      ok: true,
    });
    expect(parseAdvisorPilot("[]")).toEqual({ value: [], ok: true });
    for (const raw of ["", "nope", "{}", "[1]", '["Grace Chapel"]', '["ok","../x"]']) {
      expect(parseAdvisorPilot(raw), raw).toEqual({ value: [], ok: false });
    }
  });

  it("cleans a pilot list for saving, refusing anything that is not a slug", () => {
    expect(normaliseAdvisorPilot([" Grace-Chapel ", "grace-chapel", "rccg-1"])).toEqual(["grace-chapel", "rccg-1"]);
    expect(normaliseAdvisorPilot(["grace chapel"])).toBeNull();
    expect(normaliseAdvisorPilot([])).toEqual([]);
  });
});
