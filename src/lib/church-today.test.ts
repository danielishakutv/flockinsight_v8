import { describe, expect, it, vi } from "vitest";
import { churchToday } from "./church-today";

describe("churchToday — the church's day, not the server's", () => {
  it("is already tomorrow in Nairobi at 22:30 UTC", () => {
    expect(churchToday("Africa/Nairobi", new Date("2025-12-31T22:30:00Z"))).toBe(
      "2026-01-01",
    );
    expect(churchToday("Africa/Nairobi", new Date("2026-10-10T22:30:00Z"))).toBe(
      "2026-10-11",
    );
  });

  it("is already New Year in Lagos at 23:30 UTC on 31 December", () => {
    expect(churchToday("Africa/Lagos", new Date("2025-12-31T23:30:00Z"))).toBe(
      "2026-01-01",
    );
  });

  it("is still yesterday west of Greenwich", () => {
    expect(churchToday("America/Toronto", new Date("2026-01-01T03:00:00Z"))).toBe(
      "2025-12-31",
    );
  });

  it("treats a missing zone as the schema default, Lagos", () => {
    expect(churchToday(null, new Date("2025-12-31T23:30:00Z"))).toBe("2026-01-01");
  });

  it("falls back to UTC on a zone that does not exist, without throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(churchToday("Mars/Olympus", new Date("2026-03-01T23:30:00Z"))).toBe(
      "2026-03-01",
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
