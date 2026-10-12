import { describe, expect, it } from "vitest";
import { SUMMARY_NEEDS, summaryRefusal } from "@/lib/report-summary-access";

describe("summaryRefusal", () => {
  it("lets the owner through with no permissions listed", () => {
    expect(summaryRefusal(true, new Set())).toBeNull();
  });

  it("lets a role holding every module's view permission through", () => {
    expect(summaryRefusal(false, new Set(SUMMARY_NEEDS.map((n) => n.key)))).toBeNull();
  });

  it("refuses the default Member role, naming what is missing", () => {
    const msg = summaryRefusal(false, new Set(["members.view"]));
    expect(msg).toMatch(/giving, attendance, groups, messages/);
    expect(msg).not.toMatch(/members/);
  });

  it("refuses a role that lacks only giving — the figure a narrow role withholds", () => {
    const perms = new Set(SUMMARY_NEEDS.map((n) => n.key).filter((k) => k !== "giving.view"));
    expect(summaryRefusal(false, perms)).toMatch(/view giving\./);
  });
});
