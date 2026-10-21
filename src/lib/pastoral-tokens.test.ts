import { describe, expect, it } from "vitest";
import {
  MEMBER_TICKET_TTL_MS,
  hashToken,
  looksLikeManageToken,
  newManageToken,
  signMemberTicket,
  verifyMemberTicket,
} from "@/lib/pastoral-tokens";

const SECRET = "test-secret-do-not-use";
const NOW = new Date("2026-11-02T10:00:00Z");

describe("the manage-link token", () => {
  it("is 43 base64url characters: 256 random bits", () => {
    const token = newManageToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(looksLikeManageToken(token)).toBe(true);
    expect(newManageToken()).not.toBe(token);
  });

  it("is stored only as a stable SHA-256", () => {
    const token = newManageToken();
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
  });

  it("is refused by shape before any lookup when it is not one", () => {
    expect(looksLikeManageToken("short")).toBe(false);
    expect(looksLikeManageToken("a".repeat(42) + "/")).toBe(false);
  });
});

describe("the members-only ticket", () => {
  const ticket = signMemberTicket(
    { churchId: "church-a", memberId: "m-1", exp: NOW.getTime() + MEMBER_TICKET_TTL_MS },
    SECRET,
  );

  it("round-trips for its own church", () => {
    expect(verifyMemberTicket(ticket, "church-a", NOW, SECRET)).toEqual({ memberId: "m-1" });
  });

  it("is refused for another church", () => {
    expect(verifyMemberTicket(ticket, "church-b", NOW, SECRET)).toBeNull();
  });

  it("is refused once expired", () => {
    const later = new Date(NOW.getTime() + MEMBER_TICKET_TTL_MS + 1);
    expect(verifyMemberTicket(ticket, "church-a", later, SECRET)).toBeNull();
  });

  it("is refused when tampered with", () => {
    const [body, sig] = ticket.split(".");
    const forged = Buffer.from(JSON.stringify({ churchId: "church-a", memberId: "m-2", exp: 9e15 })).toString("base64url");
    expect(verifyMemberTicket(`${forged}.${sig}`, "church-a", NOW, SECRET)).toBeNull();
    expect(verifyMemberTicket(`${body}.${sig}x`, "church-a", NOW, SECRET)).toBeNull();
    expect(verifyMemberTicket(`${body}.${sig}.extra`, "church-a", NOW, SECRET)).toBeNull();
  });

  it("is refused with a different secret, and with no secret at all (no fallback)", () => {
    expect(verifyMemberTicket(ticket, "church-a", NOW, "another-secret")).toBeNull();
    expect(verifyMemberTicket(ticket, "church-a", NOW, null)).toBeNull();
    expect(verifyMemberTicket(ticket, "church-a", NOW, "")).toBeNull();
  });
});
