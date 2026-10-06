import { describe, expect, it } from "vitest";
import { cleanIntake, today } from "@/lib/first-timer-shared";

/**
 * The first-timer form is the only place in the app where a stranger with a
 * link can put a row into a church's register. These rules are what stands
 * between that link and the register, so they are tested as rules rather than
 * exercised through a page.
 */

const AT = new Date("2026-10-06T09:00:00Z");
const TODAY = today(AT);

function ok(input: Parameters<typeof cleanIntake>[0]) {
  const r = cleanIntake(input, AT);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.value;
}

describe("what it refuses", () => {
  it("needs a first name", () => {
    const r = cleanIntake({ firstName: "   ", phone: "08138634369" }, AT);
    expect(r.ok).toBe(false);
  });

  it("needs a way to reach them, or there is no follow-up to do", () => {
    const r = cleanIntake({ firstName: "Grace" }, AT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/phone number or an email/i);
  });

  it("accepts a phone alone, which is the common case at a welcome desk", () => {
    expect(ok({ firstName: "Grace", phone: "08138634369" }).phone).toBe(
      "08138634369",
    );
  });

  it("accepts an email alone", () => {
    expect(ok({ firstName: "Grace", email: "g@example.com" }).email).toBe(
      "g@example.com",
    );
  });

  it("refuses an email that could never be delivered to", () => {
    const r = cleanIntake({ firstName: "Grace", email: "not-an-email" }, AT);
    expect(r.ok).toBe(false);
  });
});

describe("the visit date", () => {
  it("defaults to today when nobody said", () => {
    expect(ok({ firstName: "Grace", phone: "0813" }).firstVisitDate).toBe(TODAY);
  });

  it("keeps a real date that has already happened", () => {
    expect(
      ok({ firstName: "Grace", phone: "0813", firstVisitDate: "2026-09-27" })
        .firstVisitDate,
    ).toBe("2026-09-27");
  });

  it("clamps a future date to today rather than losing the whole card", () => {
    expect(
      ok({ firstName: "Grace", phone: "0813", firstVisitDate: "2027-01-01" })
        .firstVisitDate,
    ).toBe(TODAY);
  });

  it("falls back to today for a date Postgres would throw on", () => {
    // Well-formed and impossible. Left to reach the database it would abort
    // the insert, losing a visitor to a typo.
    expect(
      ok({ firstName: "Grace", phone: "0813", firstVisitDate: "2026-02-31" })
        .firstVisitDate,
    ).toBe(TODAY);
  });

  it("falls back to today for nonsense", () => {
    for (const bad of ["yesterday", "06/10/2026", "", "2026-9-7"]) {
      expect(
        ok({ firstName: "Grace", phone: "0813", firstVisitDate: bad })
          .firstVisitDate,
      ).toBe(TODAY);
    }
  });
});

describe("who invited them", () => {
  const ID = "4bab806f-e4cd-4769-806f-08d0cc064a30";

  it("keeps the member they were picked from", () => {
    const v = ok({ firstName: "Grace", phone: "0813", invitedById: ID });
    expect(v.invitedById).toBe(ID);
  });

  it("keeps a typed name when nobody was picked", () => {
    const v = ok({ firstName: "Grace", phone: "0813", invitedByName: "Sister Ada" });
    expect(v.invitedById).toBeNull();
    expect(v.invitedByName).toBe("Sister Ada");
  });

  it("drops the typed name once a member was picked", () => {
    // Two answers to one question is worse than one. The picked member is the
    // one that can actually be joined to.
    const v = ok({
      firstName: "Grace",
      phone: "0813",
      invitedById: ID,
      invitedByName: "someone else entirely",
    });
    expect(v.invitedById).toBe(ID);
    expect(v.invitedByName).toBeNull();
  });

  it("ignores an id that is not a uuid, rather than sending it to the database", () => {
    const v = ok({ firstName: "Grace", phone: "0813", invitedById: "1 OR 1=1" });
    expect(v.invitedById).toBeNull();
  });
});

describe("tidying up", () => {
  it("trims, and lowercases the email so matching works later", () => {
    const v = ok({
      firstName: "  Grace  ",
      lastName: "  Audu ",
      email: "  Grace.AUDU@Example.COM ",
    });
    expect(v.firstName).toBe("Grace");
    expect(v.lastName).toBe("Audu");
    expect(v.email).toBe("grace.audu@example.com");
  });

  it("turns an empty optional field into null, not an empty string", () => {
    const v = ok({ firstName: "Grace", phone: "0813", lastName: "   ", city: "" });
    expect(v.lastName).toBeNull();
    expect(v.city).toBeNull();
  });

  it("reads only male or female as a gender, and anything else as unknown", () => {
    expect(ok({ firstName: "G", phone: "0813", gender: "MALE" }).gender).toBe("male");
    expect(ok({ firstName: "G", phone: "0813", gender: "female" }).gender).toBe("female");
    expect(ok({ firstName: "G", phone: "0813", gender: "other" }).gender).toBeNull();
    expect(ok({ firstName: "G", phone: "0813", gender: "" }).gender).toBeNull();
  });

  it("caps every field, so one request cannot post a novel", () => {
    const long = "x".repeat(50_000);
    const v = ok({
      firstName: long,
      phone: "0813",
      lastName: long,
      notes: long,
      address: long,
      invitedByName: long,
    });
    expect(v.firstName.length).toBeLessThanOrEqual(80);
    expect(v.lastName!.length).toBeLessThanOrEqual(80);
    expect(v.notes!.length).toBeLessThanOrEqual(1000);
    expect(v.address!.length).toBeLessThanOrEqual(200);
    expect(v.invitedByName!.length).toBeLessThanOrEqual(120);
  });

  it("survives a payload with the wrong types in it", () => {
    // The public endpoint receives whatever anybody sends.
    const v = cleanIntake(
      {
        firstName: "Grace",
        phone: 8138634369 as unknown as string,
        lastName: { bad: true } as unknown as string,
        notes: ["a", "b"] as unknown as string,
      },
      AT,
    );
    // The phone was not a string, so there is no way to reach them.
    expect(v.ok).toBe(false);
  });
});

describe("today()", () => {
  it("is date-only, so no timezone can move it", () => {
    expect(today(new Date("2026-01-05T23:30:00"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("pads the month and day", () => {
    expect(today(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
