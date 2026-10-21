import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries";
import { englishT } from "@/lib/i18n/translate";
import {
  bookerEmail,
  messageLocale,
  pastorEmail,
  pastorNotice,
  remindAtFor,
  smsCancelled,
  smsConfirmed,
  smsMoved,
  smsPending,
  smsReminder,
  smsTiming,
  type EmailKind,
  type MessageFacts,
} from "@/lib/pastoral-messages";

const LAGOS = "Africa/Lagos"; // UTC+1, no daylight saving
const t = englishT(en);
const EARLY = new Date("2026-10-01T00:00:00Z");

const facts: MessageFacts = {
  church: "Grace Chapel",
  type: "Counselling",
  pastor: "Pastor Ade",
  when: "Tue 3 Nov, 10:00",
  link: "https://flockinsight.com/appointment/abc",
  bookerName: "Ada Obi",
  location: "At the church",
  address: null,
  note: null,
};

describe("when the reminder is due", () => {
  it("keeps a target inside 8am-8pm as it is", () => {
    // Wednesday 14:00 local, a day ahead: Tuesday 14:00 local = 13:00Z.
    const at = remindAtFor(new Date("2026-11-04T13:00:00Z"), 1440, LAGOS, EARLY);
    expect(at?.toISOString()).toBe("2026-11-03T13:00:00.000Z");
  });

  it("moves a 21:00 target to 19:00 the same day", () => {
    const at = remindAtFor(new Date("2026-11-04T20:00:00Z"), 1440, LAGOS, EARLY);
    expect(at?.toISOString()).toBe("2026-11-03T18:00:00.000Z");
  });

  it("moves a 06:00 target to 19:00 the day before, earlier rather than later", () => {
    const at = remindAtFor(new Date("2026-11-04T05:00:00Z"), 1440, LAGOS, EARLY);
    expect(at?.toISOString()).toBe("2026-11-02T18:00:00.000Z");
  });

  it("returns null when the reminder would land within half an hour of now", () => {
    const startsAt = new Date("2026-11-04T12:00:00Z");
    const now = new Date(startsAt.getTime() - 40 * 60_000);
    expect(remindAtFor(startsAt, 60, LAGOS, now)).toBeNull();
  });
});

describe("when a text may go", () => {
  it("sends inside the window", () => {
    expect(smsTiming(new Date("2026-11-02T18:30:00Z"), new Date("2026-11-03T09:00:00Z"), LAGOS)).toBe("send");
  });

  it("queues after 8pm for an appointment late enough the next morning", () => {
    expect(smsTiming(new Date("2026-11-02T19:30:00Z"), new Date("2026-11-03T09:00:00Z"), LAGOS)).toBe("queue");
  });

  it("skips a text that could only arrive within half an hour of the start", () => {
    // 20:30 local; the window opens 08:00; the appointment is 08:15.
    expect(smsTiming(new Date("2026-11-02T19:30:00Z"), new Date("2026-11-03T07:15:00Z"), LAGOS)).toBe("skip");
    // 07:00 local; the window opens 08:00; the appointment is 08:20.
    expect(smsTiming(new Date("2026-11-03T06:00:00Z"), new Date("2026-11-03T07:20:00Z"), LAGOS)).toBe("skip");
    // ...but 09:00 leaves time.
    expect(smsTiming(new Date("2026-11-03T06:00:00Z"), new Date("2026-11-03T08:00:00Z"), LAGOS)).toBe("queue");
  });
});

describe("texts", () => {
  const builders = [smsConfirmed, smsPending, smsReminder, smsMoved];

  it("end with the manage link and never carry HTML", () => {
    for (const build of builders) {
      const body = build(t, facts);
      expect(body.endsWith(facts.link)).toBe(true);
      expect(body).not.toMatch(/[<>]/);
      expect(body).not.toMatch(/\{\w+\}/);
    }
  });

  it("say a cancellation with the church's note and no link", () => {
    const body = smsCancelled(t, { ...facts, note: "The pastor is unwell." });
    expect(body).toContain("The pastor is unwell.");
    expect(body).not.toContain(facts.link);
  });

  it("have no parameter that could carry what the appointment is about", () => {
    // The facts type has no topic field at all; a stray one is simply ignored.
    const body = smsConfirmed(t, { ...facts, ...({ topic: "marriage difficulties" } as object) } as MessageFacts);
    expect(body).not.toContain("marriage");
  });
});

describe("emails", () => {
  const kinds: EmailKind[] = ["confirmed", "pending", "reminder", "cancelled", "declined", "moved"];

  it("escape anything a person typed", () => {
    const e = bookerEmail(t, "declined", {
      ...facts,
      bookerName: "<script>alert(1)</script>",
      note: "<img src=x onerror=alert(1)>",
    });
    expect(e.html).not.toContain("<script>");
    expect(e.html).not.toContain("<img src=x");
    expect(e.html).toContain("&lt;script&gt;");
  });

  it("build every kind in English with no missing key or placeholder", () => {
    for (const kind of kinds) {
      const e = bookerEmail(t, kind, facts);
      expect(e.subject).not.toMatch(/pastoral\.|\{\w+\}/);
      expect(e.text).not.toMatch(/pastoral\.|\{\w+\}/);
      expect(e.html).not.toMatch(/\{\w+\}/);
    }
  });

  it("carry the manage button only while the appointment is live", () => {
    expect(bookerEmail(t, "confirmed", facts).html).toContain(facts.link);
    expect(bookerEmail(t, "cancelled", facts).html).not.toContain(facts.link);
  });

  it("tell the pastor without a topic, in words", () => {
    const n = pastorNotice(t, "pending", facts);
    expect(n.title).toContain("Counselling");
    expect(n.body).toContain("Ada Obi");
    const e = pastorEmail(t, "new", facts, "https://flockinsight.com/appointments");
    expect(e.subject).not.toMatch(/pastoral\.|\{\w+\}/);
  });
});

describe("which language", () => {
  it("prefers the booker's, then the church's, then the country's", () => {
    expect(messageLocale({ locale: "pt" }, { defaultLocale: "fr", country: "Nigeria" })).toBe("pt");
    expect(messageLocale({ locale: null }, { defaultLocale: "fr", country: "Nigeria" })).toBe("fr");
    expect(messageLocale({ locale: "xx" }, { defaultLocale: null, country: "Mozambique" })).toBe("pt");
    expect(messageLocale({}, { defaultLocale: null, country: "Nigeria" })).toBe("en");
  });
});
