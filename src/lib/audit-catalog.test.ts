import { describe, expect, it } from "vitest";
import {
  AUDIT_MODULES,
  describeAction,
  diffFields,
  moduleOf,
  sanitiseMeta,
  severityFor,
  summariseChanges,
} from "@/lib/audit-catalog";

describe("the module list", () => {
  it("has no duplicates", () => {
    const keys = AUDIT_MODULES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses lowercase keys that can head a dotted action", () => {
    for (const m of AUDIT_MODULES) expect(m.key).toMatch(/^[a-z]+$/);
  });

  it("reads the module off the front of an action key", () => {
    expect(moduleOf("members.member.create")).toBe("members");
    expect(moduleOf("finance.transaction.delete")).toBe("finance");
    expect(moduleOf("meetings.stage.update")).toBe("meetings");
  });

  it("files an unknown prefix under the platform rather than losing it", () => {
    expect(moduleOf("gibberish.thing.create")).toBe("platform");
    expect(moduleOf("impersonate")).toBe("platform");
  });
});

describe("severity", () => {
  it("marks a deletion as worth noticing", () => {
    expect(severityFor("members.member.delete")).toBe("warning");
    expect(severityFor("finance.transaction.delete")).toBe("warning");
  });

  it("marks anything touching access as sensitive", () => {
    expect(severityFor("team.role.grant")).toBe("critical");
    expect(severityFor("team.role.revoke")).toBe("critical");
    expect(severityFor("platform.password.reset")).toBe("critical");
    expect(severityFor("platform.church.impersonate")).toBe("critical");
  });

  it("treats an export as worth noticing — it is data leaving", () => {
    expect(severityFor("settings.activity.export")).toBe("warning");
    expect(severityFor("reports.members.download")).toBe("warning");
  });

  it("leaves an ordinary write alone", () => {
    expect(severityFor("members.member.create")).toBe("info");
    expect(severityFor("attendance.session.update")).toBe("info");
  });
});

describe("describing an action", () => {
  it("never returns an empty label", () => {
    for (const key of [
      "members.member.create",
      "finance.account.archive",
      "auth.session.login",
      "weird",
      "a.b",
    ]) {
      expect(describeAction(key).length).toBeGreaterThan(0);
    }
  });

  it("reads as words rather than as a key", () => {
    expect(describeAction("members.member.create")).toBe("Create member");
    expect(describeAction("finance.transaction.delete")).toBe("Delete transaction");
  });
});

/* ============================================================
 * The part that must not leak
 * ========================================================== */

describe("redacting metadata", () => {
  it("never lets a credential through", () => {
    const meta = sanitiseMeta({
      password: "hunter2",
      newPassword: "hunter3",
      apiKey: "sk-live-abc",
      access_token: "ey.J.x",
      sessionCookie: "abc",
      otp: "123456",
      cardCvv: "999",
      authorization: "Bearer x",
      credentials: { user: "a", pass: "b" },
    });

    const serialised = JSON.stringify(meta);
    expect(serialised).not.toContain("hunter2");
    expect(serialised).not.toContain("hunter3");
    expect(serialised).not.toContain("sk-live-abc");
    expect(serialised).not.toContain("ey.J.x");
    expect(serialised).not.toContain("123456");
    for (const v of Object.values(meta)) expect(v).toBe("[redacted]");
  });

  it("catches a secret nested inside an object", () => {
    const meta = sanitiseMeta({ changed: { password: { from: "a", to: "b" } } });
    expect(JSON.stringify(meta)).not.toContain('"a"');
    expect(JSON.stringify(meta)).toContain("[redacted]");
  });

  it("keeps the ordinary fields an entry is actually for", () => {
    const meta = sanitiseMeta({
      amount: 12000,
      currency: "NGN",
      name: "Grace Okoro",
      active: true,
      nothing: null,
    });
    expect(meta).toEqual({
      amount: 12000,
      currency: "NGN",
      name: "Grace Okoro",
      active: true,
      nothing: null,
    });
  });

  it("caps a long string instead of storing an essay", () => {
    const meta = sanitiseMeta({ note: "x".repeat(5000) });
    expect(String(meta.note).length).toBeLessThan(600);
  });

  it("survives nonsense without throwing", () => {
    expect(sanitiseMeta(null)).toEqual({});
    expect(sanitiseMeta(undefined)).toEqual({});
  });

  it("does not follow a deeply nested structure for ever", () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 50; i++) deep = { nested: deep };
    expect(() => sanitiseMeta(deep)).not.toThrow();
  });
});

/* ============================================================
 * What changed
 * ========================================================== */

describe("diffing a record", () => {
  it("reports only what actually moved", () => {
    const changed = diffFields(
      { name: "Grace", phone: "0801", status: "active" },
      { name: "Grace Okoro", phone: "0801", status: "active" },
    );
    expect(Object.keys(changed)).toEqual(["name"]);
    expect(changed.name).toEqual({ from: "Grace", to: "Grace Okoro" });
  });

  it("compares the way a person would", () => {
    // These are the false positives that turn an audit log into noise.
    expect(diffFields({ n: 5 }, { n: "5" })).toEqual({});
    expect(diffFields({ x: null }, { x: "" })).toEqual({});
    expect(diffFields({ x: undefined }, { x: null })).toEqual({});
    const d = new Date("2026-01-01T00:00:00.000Z");
    expect(diffFields({ at: d }, { at: new Date(d) })).toEqual({});
  });

  it("never diffs a secret, even if asked to", () => {
    const changed = diffFields(
      { password: "old", name: "a" },
      { password: "new", name: "b" },
    );
    expect(changed.password).toBeUndefined();
    expect(changed.name).toBeDefined();
  });

  it("only looks at the fields it was given", () => {
    const changed = diffFields(
      { a: 1, b: 1, updatedAt: "x" },
      { a: 2, b: 2, updatedAt: "y" },
      ["a"],
    );
    expect(Object.keys(changed)).toEqual(["a"]);
  });
});

describe("summarising changes", () => {
  it("reads as a sentence for a few fields", () => {
    expect(summariseChanges({ name: 1 })).toBe("name");
    expect(summariseChanges({ name: 1, email: 1 })).toBe("name and email");
    expect(summariseChanges({ a: 1, b: 1, c: 1 })).toBe("a, b and c");
  });

  it("counts instead of listing when there are many", () => {
    expect(summariseChanges({ a: 1, b: 1, c: 1, d: 1, e: 1 })).toBe("5 fields");
  });

  it("splits a camelCase field into words", () => {
    expect(summariseChanges({ dateOfBirth: 1 })).toBe("date of birth");
  });

  it("takes a label when one is given", () => {
    expect(summariseChanges({ lowDataDefault: 1 }, { lowDataDefault: "low data mode" }))
      .toBe("low data mode");
  });

  it("says so rather than producing an empty sentence", () => {
    expect(summariseChanges({})).toBe("no changes");
  });
});
