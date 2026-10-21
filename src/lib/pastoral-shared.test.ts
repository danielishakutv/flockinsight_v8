import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries";
import { englishT } from "@/lib/i18n/translate";
import { timezoneForCountry } from "@/lib/country-profile";
import {
  HOLDING_STATUSES,
  anyDelivered,
  churchZone,
  describeDelivery,
  failedToken,
  formatOutcome,
  hhmmToMinutes,
  holdsTheSlot,
  minutesToHHMM,
  splitName,
  validateBooker,
  validateWeeklyHours,
} from "@/lib/pastoral-shared";

const t = englishT(en);

describe("weekly hours", () => {
  it("refuses two overlapping sets of hours, naming the day", () => {
    const res = validateWeeklyHours([
      { weekday: 1, startMinute: 540, endMinute: 720 },
      { weekday: 1, startMinute: 690, endMinute: 900 },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.key).toBe("pastoral.hours.overlap");
      expect(t(res.error.key, res.error.vars)).toContain("Monday");
    }
  });

  it("allows windows that only touch, and returns them sorted", () => {
    const res = validateWeeklyHours([
      { weekday: 2, startMinute: 720, endMinute: 900 },
      { weekday: 2, startMinute: 540, endMinute: 720 },
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.map((w) => w.startMinute)).toEqual([540, 720]);
  });

  it("refuses an end before the start, an off-step minute and a day that is not a day", () => {
    expect(validateWeeklyHours([{ weekday: 3, startMinute: 600, endMinute: 540 }]).ok).toBe(false);
    expect(validateWeeklyHours([{ weekday: 3, startMinute: 541, endMinute: 600 }]).ok).toBe(false);
    expect(validateWeeklyHours([{ weekday: 7, startMinute: 540, endMinute: 600 }]).ok).toBe(false);
  });

  it("names the day in the reader's language when given the names", () => {
    const res = validateWeeklyHours(
      [{ weekday: 0, startMinute: 600, endMinute: 540 }],
      ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
    );
    expect(!res.ok && res.error.vars?.day).toBe("dimanche");
  });

  it("converts times both ways, with midnight as the end of the day", () => {
    expect(minutesToHHMM(570)).toBe("09:30");
    expect(hhmmToMinutes("09:30")).toBe(570);
    expect(hhmmToMinutes("24:00")).toBe(1440);
    expect(hhmmToMinutes("24:30")).toBeNull();
    expect(hhmmToMinutes("nine")).toBeNull();
  });
});

describe("the person booking", () => {
  const dial = "234";

  it("needs an address for a home visit", () => {
    const res = validateBooker({ name: "Ada Obi", phone: "08031234567" }, { location: "home", needContact: true, dial });
    expect(!res.ok && res.error.key).toBe("pastoral.errors.addressNeeded");
  });

  it("needs a phone or an email on the public page, and not from staff", () => {
    expect(validateBooker({ name: "Ada Obi" }, { location: "church", needContact: true, dial }).ok).toBe(false);
    expect(validateBooker({ name: "Ada Obi" }, { location: "church", needContact: false, dial }).ok).toBe(true);
  });

  it("stores the phone in E.164 with the church's dial code, and the email lower-cased", () => {
    const res = validateBooker(
      { name: "  Ada Obi ", phone: "0803 123 4567", email: "Ada@Example.com" },
      { location: "church", needContact: true, dial },
    );
    expect(res.ok && res.value).toMatchObject({ name: "Ada Obi", phone: "+2348031234567", email: "ada@example.com" });
  });

  it("refuses a malformed phone or email rather than storing it", () => {
    expect(validateBooker({ name: "Ada", phone: "12" }, { location: "church", needContact: true, dial }).ok).toBe(false);
    expect(validateBooker({ name: "Ada", email: "ada@" }, { location: "church", needContact: true, dial }).ok).toBe(false);
  });

  it("splits a name for the register", () => {
    expect(splitName("Ade Tunde Okafor")).toEqual({ firstName: "Ade Tunde", lastName: "Okafor" });
    expect(splitName("Ade")).toEqual({ firstName: "Ade", lastName: null });
  });
});

describe("what holds a slot", () => {
  it("is pending and confirmed, and nothing else", () => {
    expect(HOLDING_STATUSES).toEqual(["pending", "confirmed"]);
    expect(holdsTheSlot("pending")).toBe(true);
    expect(holdsTheSlot("confirmed")).toBe(true);
    expect(holdsTheSlot("declined")).toBe(false);
    expect(holdsTheSlot("cancelled")).toBe(false);
  });

  it("matches the exclusion constraint's WHERE in migration 0106 exactly", () => {
    const sqlText = readFileSync(
      join(import.meta.dirname, "..", "db", "migrations", "0106_roadmap_features.sql"),
      "utf8",
    );
    const at = sqlText.indexOf("pastoral_appointment_no_overlap\"");
    expect(at).toBeGreaterThan(-1);
    const where = /WHERE \("status" in \(([^)]*)\)\)/.exec(sqlText.slice(at));
    expect(where).not.toBeNull();
    const statuses = (where?.[1] ?? "").split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(statuses).toEqual([...HOLDING_STATUSES]);
  });
});

describe("the church's zone", () => {
  it("uses the stored zone when Intl knows it, and the country's otherwise", () => {
    expect(churchZone({ timezone: "Africa/Maputo", country: "Mozambique" })).toBe("Africa/Maputo");
    expect(churchZone({ timezone: "GMT+2", country: "Mozambique" })).toBe(timezoneForCountry("Mozambique"));
    expect(churchZone({ timezone: null, country: "Nigeria" })).toBe("Africa/Lagos");
  });
});

describe("what happened to each message", () => {
  it("maps every outcome token to a line", () => {
    const outcome = formatOutcome({ email: "sent", sms: "queued@2026-11-02T07:00:00.000Z" });
    expect(outcome).toBe("email:sent sms:queued@2026-11-02T07:00:00.000Z");
    const lines = describeDelivery(outcome, () => "8:00");
    expect(lines).toEqual([
      { channel: "email", key: "pastoral.sheet.delivery.sent" },
      { channel: "sms", key: "pastoral.sheet.delivery.queued", vars: { time: "8:00" } },
    ]);
    expect(describeDelivery("email:off sms:noplan").map((l) => l.key)).toEqual([
      "pastoral.sheet.delivery.off",
      "pastoral.sheet.delivery.noPlan",
    ]);
    expect(describeDelivery("sms:skipped")[0].key).toBe("pastoral.sheet.delivery.skipped");
  });

  it("keeps a failure reason readable through one space-free token", () => {
    const outcome = formatOutcome({ email: failedToken("mailbox is full") });
    expect(outcome).toBe("email:failed:mailbox_is_full");
    expect(describeDelivery(outcome)[0]).toEqual({
      channel: "email",
      key: "pastoral.sheet.delivery.failed",
      vars: { reason: "mailbox is full" },
    });
  });

  it("knows whether anything actually went", () => {
    expect(anyDelivered("email:failed:x sms:queued@2026")).toBe(true);
    expect(anyDelivered("email:sent")).toBe(true);
    expect(anyDelivered("email:off sms:noplan")).toBe(false);
    expect(anyDelivered(null)).toBe(false);
  });

  it("renders every line in English without a missing key", () => {
    for (const l of describeDelivery("email:sent sms:queued@x email:skipped sms:failed:a email:off sms:noplan")) {
      expect(t(l.key, l.vars)).not.toMatch(/pastoral\.|\{/);
    }
  });
});
