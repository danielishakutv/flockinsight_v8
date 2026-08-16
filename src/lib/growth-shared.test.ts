import { describe, expect, it } from "vitest";
import {
  followUpLabel,
  headerToLeadField,
  leadStatusMeta,
  renderTemplate,
  whatsappLink,
} from "./growth-shared";

describe("renderTemplate", () => {
  it("fills every tag", () => {
    expect(
      renderTemplate("Hi {name}, does {church} in {city} still count by hand?", {
        name: "Daniel Ishaku",
        church: "Grace Chapel",
        city: "Yola",
      }),
    ).toBe("Hi Daniel, does Grace Chapel in Yola still count by hand?");
  });

  it("uses the first name only", () => {
    expect(renderTemplate("{name}", { name: "Pastor Daniel Ishaku" })).toBe(
      "Pastor",
    );
  });

  it("never leaves a raw tag when a value is missing", () => {
    expect(renderTemplate("Hi {name} at {church} in {city}", {})).toBe(
      "Hi there at your church in your area",
    );
    expect(renderTemplate("Hi {name}", { name: "   " })).toBe("Hi there");
  });

  it("accepts tags in any case", () => {
    expect(renderTemplate("{NAME} / {Church}", { name: "Ada", church: "Zion" })).toBe(
      "Ada / Zion",
    );
  });

  it("replaces every occurrence", () => {
    expect(renderTemplate("{church}, yes {church}", { church: "Zion" })).toBe(
      "Zion, yes Zion",
    );
  });
});

describe("headerToLeadField", () => {
  it("maps the obvious spellings", () => {
    expect(headerToLeadField("Church Name")).toBe("churchName");
    expect(headerToLeadField("church_name")).toBe("churchName");
    expect(headerToLeadField("  ORGANISATION ")).toBe("churchName");
    expect(headerToLeadField("Phone Number")).toBe("phone");
    expect(headerToLeadField("Pastor")).toBe("contactName");
    expect(headerToLeadField("Members")).toBe("size");
  });

  it("returns null for a column we don't understand", () => {
    expect(headerToLeadField("Favourite hymn")).toBeNull();
  });
});

describe("whatsappLink", () => {
  it("builds a link from a local number", () => {
    expect(whatsappLink("0808 825 6055")).toBe("https://wa.me/2348088256055");
  });

  it("accepts an international number", () => {
    expect(whatsappLink("+234 808 825 6055")).toBe("https://wa.me/2348088256055");
  });

  it("gives up on something unusable", () => {
    expect(whatsappLink("123")).toBeNull();
    expect(whatsappLink("")).toBeNull();
    expect(whatsappLink(null)).toBeNull();
  });
});

describe("followUpLabel", () => {
  // Local-time constructors: "due today" is about the reader's calendar day,
  // so a UTC literal would flip the answer depending on the machine's zone.
  const day = (d: number, hour = 9) => new Date(2026, 7, d, hour);
  const now = day(16);

  it("says nothing when there's no date", () => {
    expect(followUpLabel(null, now)).toBeNull();
  });

  it("flags today", () => {
    const r = followUpLabel(day(16, 23), now);
    expect(r).toEqual({ text: "Due today", overdue: false, dueToday: true });
  });

  it("counts overdue days", () => {
    expect(followUpLabel(day(13), now)?.text).toBe(
      "3 days overdue",
    );
    expect(followUpLabel(day(15), now)).toMatchObject({
      text: "1 day overdue",
      overdue: true,
    });
  });

  it("counts forward", () => {
    expect(followUpLabel(day(17), now)?.text).toBe(
      "Due tomorrow",
    );
    expect(followUpLabel(day(21), now)?.text).toBe(
      "Due in 5 days",
    );
  });

  it("ignores a broken date", () => {
    expect(followUpLabel("not a date", now)).toBeNull();
  });
});

describe("leadStatusMeta", () => {
  it("knows every stage", () => {
    expect(leadStatusMeta("converted").label).toBe("Converted");
  });

  it("falls back rather than crashing on an unknown value", () => {
    expect(leadStatusMeta("something-else").label).toBe("New");
  });
});
