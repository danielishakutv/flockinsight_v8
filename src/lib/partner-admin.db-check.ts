/**
 * Managing a Partner's account from superadmin. Run with `pnpm test:db`.
 *
 * The one rule here that only the database can prove is the difference
 * between PAUSED and SUSPENDED, because it is decided inside
 * `awardPartnerCommission` against a real payment: a paused Partner keeps
 * earning, a suspended one does not. If those two ever behave the same, the
 * superadmin page is lying about what its buttons cost somebody.
 *
 * The rest are the writes the page makes, each with the side effect that is
 * easy to lose: a status change leaving the note and tier override alone (it
 * used to blank the note), a new phone losing its verification, an email
 * change taking back the Partner's withdrawal verification, and signing out
 * reaching every live session and no other account's.
 *
 * Every row this file writes is a fixture it created, named with a `zzcheck-`
 * prefix, and it removes only those at the end.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

const sent: { to: string; subject: string }[] = [];
vi.mock("@/lib/mailer", () => ({
  emailLayout: (title: string, body: string) => `${title}\n${body}`,
  sendEmail: async (m: { to: string; subject: string }) => {
    sent.push({ to: m.to, subject: m.subject });
    return true;
  },
}));
// admin-users hashes passwords through Better Auth; nothing here does.
vi.mock("@/lib/auth", () => ({ auth: {} }));

import { db } from "@/db";
import {
  church,
  partner,
  partnerEarning,
  partnerReferral,
  payment,
  session,
  user,
} from "@/db/schema";
import {
  awardPartnerCommission,
  setPartnerStatus,
  setPartnerVerification,
  updatePartnerProfile,
} from "@/lib/partners";
import { afterAccountEmailChanged, expireUserSessions } from "@/lib/admin-users";
import { DEFAULT_PARTNER_RATES } from "@/lib/partners-shared";

const STAMP = Date.now().toString(36);
const USER_ID = `zzcheck-padmin-${STAMP}`;
const OTHER_USER_ID = `zzcheck-padmin-other-${STAMP}`;
const CHURCH_ID = `zzcheck-padmin-church-${STAMP}`;
const SESSION_IDS = [0, 1, 2].map((i) => `zzcheck-padmin-s${i}-${STAMP}`);

let partnerId = "";

async function readPartner() {
  const [row] = await db.select().from(partner).where(eq(partner.id, partnerId)).limit(1);
  return row;
}

async function payAndAward(paidAt: Date): Promise<number> {
  const [row] = await db
    .insert(payment)
    .values({
      churchId: CHURCH_ID,
      plan: "growth",
      amount: 10_000,
      currency: "NGN",
      gateway: "paystack",
      reference: `zzcheck-${STAMP}-${Math.random().toString(36).slice(2, 10)}`,
      status: "success",
      periodMonths: 1,
      paidAt,
    })
    .returning({ id: payment.id });
  await awardPartnerCommission(row.id);
  const earned = await db
    .select({ id: partnerEarning.id })
    .from(partnerEarning)
    .where(eq(partnerEarning.paymentId, row.id));
  return earned.length;
}

beforeAll(async () => {
  await db.insert(user).values([
    { id: USER_ID, name: "Admin Check", email: `${USER_ID}@example.com` },
    { id: OTHER_USER_ID, name: "Bystander", email: `${OTHER_USER_ID}@example.com` },
  ]);
  const [p] = await db
    .insert(partner)
    .values({
      userId: USER_ID,
      code: `ZQ${STAMP.toUpperCase().slice(-6)}`,
      displayName: "Admin Check",
      status: "active",
      phone: "2348000000002",
      phoneVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
      tierOverride: DEFAULT_PARTNER_RATES.tiers[0].name,
      note: "Founding agent — agreed by phone.",
    })
    .returning({ id: partner.id });
  partnerId = p.id;

  await db.insert(church).values({
    id: CHURCH_ID,
    name: "Admin Check Church",
    slug: `zzcheck-padmin-${STAMP}`,
    plan: "growth",
    status: "active",
  });
  await db.insert(partnerReferral).values({ partnerId, churchId: CHURCH_ID, source: "link" });
});

afterAll(async () => {
  if (partnerId) {
    await db.delete(partnerEarning).where(eq(partnerEarning.partnerId, partnerId));
  }
  await db.delete(payment).where(eq(payment.churchId, CHURCH_ID));
  await db.delete(session).where(inArray(session.id, SESSION_IDS));
  await db.delete(user).where(inArray(user.id, [USER_ID, OTHER_USER_ID]));
  await db.delete(church).where(eq(church.id, CHURCH_ID));
});

describe("pausing versus suspending", () => {
  it("keeps earning while paused", async () => {
    const res = await setPartnerStatus({ partnerId, status: "paused", reason: "Checking the bank account" });
    expect(res.ok).toBe(true);
    expect(await payAndAward(new Date("2026-01-05T10:00:00Z"))).toBeGreaterThan(0);
  });

  it("earns nothing while suspended", async () => {
    await setPartnerStatus({ partnerId, status: "suspended", reason: "Self-referral" });
    expect(await payAndAward(new Date("2026-02-05T10:00:00Z"))).toBe(0);
  });

  it("earns again once reinstated", async () => {
    await setPartnerStatus({ partnerId, status: "active" });
    expect(await payAndAward(new Date("2026-03-05T10:00:00Z"))).toBeGreaterThan(0);
  });
});

describe("a status change", () => {
  it("leaves the note and the tier override alone", async () => {
    // The status dropdown used to send neither, and the note was blanked.
    await setPartnerStatus({ partnerId, status: "paused", reason: "x" });
    await setPartnerStatus({ partnerId, status: "active" });
    const p = await readPartner();
    expect(p.note).toBe("Founding agent — agreed by phone.");
    expect(p.tierOverride).toBe(DEFAULT_PARTNER_RATES.tiers[0].name);
  });

  it("keeps the reason only while it explains a hold", async () => {
    await setPartnerStatus({ partnerId, status: "paused", reason: "  Bank check  " });
    expect((await readPartner()).statusReason).toBe("Bank check");
    await setPartnerStatus({ partnerId, status: "active", reason: "ignored" });
    expect((await readPartner()).statusReason).toBeNull();
  });

  it("does not reset 'since' when only the reason is reworded", async () => {
    await setPartnerStatus({ partnerId, status: "paused", reason: "first wording" });
    const since = (await readPartner()).statusChangedAt;
    const again = await setPartnerStatus({ partnerId, status: "paused", reason: "second wording" });
    expect(again.ok && again.changed).toBe(false);
    const p = await readPartner();
    expect(p.statusReason).toBe("second wording");
    expect(p.statusChangedAt?.getTime()).toBe(since?.getTime());
    await setPartnerStatus({ partnerId, status: "active" });
  });

  it("refuses a Partner that does not exist", async () => {
    const res = await setPartnerStatus({
      partnerId: "00000000-0000-4000-8000-000000000000",
      status: "paused",
    });
    expect(res.ok).toBe(false);
  });
});

describe("editing a Partner's details", () => {
  it("keeps the phone verification for the same number spelled differently", async () => {
    const res = await updatePartnerProfile({
      partnerId,
      displayName: "Admin Check",
      phone: "0800 000 0002",
      tierOverride: DEFAULT_PARTNER_RATES.tiers[0].name,
      note: "Founding agent — agreed by phone.",
    });
    expect(res.ok && res.changed.phone).toBeFalsy();
    expect((await readPartner()).phoneVerifiedAt).not.toBeNull();
  });

  it("takes the verification away from a new number", async () => {
    const res = await updatePartnerProfile({
      partnerId,
      displayName: "Admin Check",
      phone: "08000000003",
      tierOverride: DEFAULT_PARTNER_RATES.tiers[0].name,
      note: "Founding agent — agreed by phone.",
    });
    expect(res.ok && res.changed.phone).toBeTruthy();
    const p = await readPartner();
    expect(p.phone).toBe("2348000000003");
    expect(p.phoneVerifiedAt).toBeNull();
  });

  it("refuses a tier that is not on the ladder instead of saving a no-op", async () => {
    const res = await updatePartnerProfile({
      partnerId,
      displayName: "Admin Check",
      phone: "08000000003",
      tierOverride: "Platinum Deluxe",
      note: null,
    });
    expect(res.ok).toBe(false);
    expect((await readPartner()).tierOverride).toBe(DEFAULT_PARTNER_RATES.tiers[0].name);
  });

  it("will not vouch for a phone that is not there", async () => {
    await updatePartnerProfile({
      partnerId,
      displayName: "Admin Check",
      phone: "",
      tierOverride: null,
      note: null,
    });
    const res = await setPartnerVerification({ partnerId, which: "phone", verified: true });
    expect(res.ok).toBe(false);
  });
});

describe("changing the sign-in email", () => {
  it("takes back the Partner's withdrawal verification and tells both addresses", async () => {
    await setPartnerVerification({ partnerId, which: "email", verified: true });
    sent.length = 0;
    const res = await afterAccountEmailChanged({
      userId: USER_ID,
      name: "Admin Check",
      from: "old@example.com",
      to: "new@example.com",
    });
    expect(res.partnerReverify).toBe(true);
    // Counted, so the page can say when nobody was told.
    expect(res).toMatchObject({ noticesSent: 2, noticesTried: 2 });
    expect((await readPartner()).emailVerifiedAt).toBeNull();
    expect(sent.map((m) => m.to).sort()).toEqual(["new@example.com", "old@example.com"]);
  });

  it("touches no Partner row for an account that is not a Partner", async () => {
    const res = await afterAccountEmailChanged({
      userId: OTHER_USER_ID,
      name: "Bystander",
      from: "a@example.com",
      to: "b@example.com",
    });
    expect(res.partnerReverify).toBe(false);
  });
});

describe("signing out everywhere", () => {
  it("ends every live session of that account, and no one else's", async () => {
    const future = new Date(Date.now() + 7 * 86_400_000);
    await db.insert(session).values([
      { id: SESSION_IDS[0], token: SESSION_IDS[0], userId: USER_ID, expiresAt: future },
      { id: SESSION_IDS[1], token: SESSION_IDS[1], userId: USER_ID, expiresAt: future },
      { id: SESSION_IDS[2], token: SESSION_IDS[2], userId: OTHER_USER_ID, expiresAt: future },
    ]);

    expect(await expireUserSessions(USER_ID)).toBe(2);

    const rows = await db
      .select({ id: session.id, userId: session.userId, expiresAt: session.expiresAt })
      .from(session)
      .where(inArray(session.id, SESSION_IDS));
    // Kept, not deleted — the device and address are still there to read.
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      if (r.userId === USER_ID) {
        // Past by a margin no time zone can turn into the future.
        expect(r.expiresAt.getTime()).toBeLessThan(Date.now() - 86_400_000);
      } else {
        expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now());
      }
    }

    // A second press finds nothing left to end.
    expect(await expireUserSessions(USER_ID)).toBe(0);
  });
});
