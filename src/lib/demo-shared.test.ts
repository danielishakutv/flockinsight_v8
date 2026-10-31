import { describe, expect, it } from "vitest";
import { checkDemoContact } from "./demo-shared";
import { DIAL_COUNTRIES, dialCountry, matchesCountry } from "./dial-codes";

describe("checkDemoContact", () => {
  const ok = { email: "Pastor@Example.org ", phone: "0803 123 4567", country: "NG" };

  it("stores the phone with its country code and lowercases the email", () => {
    expect(checkDemoContact(ok)).toEqual({
      ok: true,
      email: "pastor@example.org",
      phone: "+2348031234567",
      country: "Nigeria",
      name: null,
    });
  });

  it("requires both email and phone; the name is optional", () => {
    expect(checkDemoContact({ ...ok, email: "" }).ok).toBe(false);
    expect(checkDemoContact({ ...ok, phone: " " }).ok).toBe(false);
    expect(checkDemoContact({ ...ok, name: "  Grace Chapel " })).toMatchObject({
      ok: true,
      name: "Grace Chapel",
    });
  });

  it("needs a country it knows", () => {
    expect(checkDemoContact({ ...ok, country: "" }).ok).toBe(false);
    expect(checkDemoContact({ ...ok, country: "XX" }).ok).toBe(false);
  });

  it("holds a number to the chosen country's length", () => {
    // One digit short of a Nigerian mobile.
    expect(checkDemoContact({ ...ok, phone: "080312345" }).ok).toBe(false);
    expect(checkDemoContact({ ...ok, country: "GB", phone: "07700 900123" })).toMatchObject({
      ok: true,
      phone: "+447700900123",
    });
  });

  it("believes a number typed with its own + code over the dropdown", () => {
    expect(checkDemoContact({ ...ok, country: "NG", phone: "+1 202 555 0143" })).toMatchObject({
      ok: true,
      phone: "+12025550143",
    });
  });
});

describe("dial codes", () => {
  it("has one row per country code, each with digits only", () => {
    const codes = DIAL_COUNTRIES.map((c) => c.iso2);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of DIAL_COUNTRIES) {
      expect(c.iso2).toMatch(/^[A-Z]{2}$/);
      expect(c.dial).toMatch(/^\d{1,3}$/);
    }
  });

  it("refuses Cloudflare's unplaceable codes", () => {
    expect(dialCountry("XX")).toBeNull();
    expect(dialCountry("T1")).toBeNull();
    expect(dialCountry("ng")?.dial).toBe("234");
  });

  it("searches by name, accents and dial digits", () => {
    const find = (q: string) => DIAL_COUNTRIES.filter((c) => matchesCountry(c, q)).map((c) => c.iso2);
    expect(find("cote")).toContain("CI");
    expect(find("+234")).toEqual(["NG"]);
    expect(find("gh")).toContain("GH");
  });
});
