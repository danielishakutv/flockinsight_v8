/**
 * Database-backed checks for going into the red. Run with `pnpm test:db`.
 *
 * An advance is the only way a wallet is allowed below zero, and the rules
 * around it are the kind that cannot be verified by reading: that ordinary
 * spending still refuses, that a top-up settles the debt rather than sitting
 * beside it, and that the ledger's running balance stays truthful across the
 * sign change.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, walletTxn } from "@/db/schema";
import { creditWallet, debitWallet, getWalletBalance } from "@/lib/wallet";

const stamp = Date.now();
const CHURCH = `zzadv-${stamp}`;

beforeAll(async () => {
  await db.insert(church).values({
    id: CHURCH,
    name: `ZZ Advance ${stamp}`,
    slug: `zz-advance-${stamp}`,
    handle: `zz-advance-${stamp}`,
    walletBalance: 0,
  });
});

afterAll(async () => {
  await db.delete(walletTxn).where(eq(walletTxn.churchId, CHURCH));
  await db.delete(church).where(inArray(church.id, [CHURCH]));
});

async function reset(to: number) {
  await db.update(church).set({ walletBalance: to }).where(eq(church.id, CHURCH));
}

describe("wallet advances", () => {
  it("refuses to overspend when no advance was asked for", async () => {
    await reset(1000);
    const res = await debitWallet({
      churchId: CHURCH,
      amount: 5000,
      category: "sms",
    });
    expect(res.ok).toBe(false);
    expect(await getWalletBalance(CHURCH)).toBe(1000);
  });

  it("goes below zero only when explicitly allowed", async () => {
    await reset(1000);
    const res = await debitWallet({
      churchId: CHURCH,
      amount: 6000,
      category: "advance",
      allowNegative: true,
      reason: "SMS sent on credit",
    });
    expect(res.ok).toBe(true);
    expect(await getWalletBalance(CHURCH)).toBe(-5000);
  });

  it("still refuses ordinary spending while they are in the red", async () => {
    // A church that owes us money must not be able to quietly owe us more.
    await reset(-5000);
    const res = await debitWallet({
      churchId: CHURCH,
      amount: 100,
      category: "sms",
    });
    expect(res.ok).toBe(false);
    expect(await getWalletBalance(CHURCH)).toBe(-5000);
  });

  it("settles the debt out of the next top-up, not beside it", async () => {
    // The whole mechanism: a credit is added to whatever the balance is, so
    // the debt is cleared first and the remainder is theirs to spend.
    await reset(-5000);
    const after = await creditWallet({
      churchId: CHURCH,
      amount: 12000,
      category: "topup",
    });
    expect(after).toBe(7000);
    expect(await getWalletBalance(CHURCH)).toBe(7000);
  });

  it("clears exactly to zero when the top-up matches the debt", async () => {
    await reset(-5000);
    expect(
      await creditWallet({ churchId: CHURCH, amount: 5000, category: "topup" }),
    ).toBe(0);
  });

  it("leaves them still owing when the top-up is not enough", async () => {
    await reset(-5000);
    expect(
      await creditWallet({ churchId: CHURCH, amount: 2000, category: "topup" }),
    ).toBe(-3000);
  });

  it("records a running balance that matches the account, through zero", async () => {
    await reset(0);
    await debitWallet({
      churchId: CHURCH,
      amount: 4000,
      category: "advance",
      allowNegative: true,
    });
    await creditWallet({ churchId: CHURCH, amount: 10000, category: "topup" });

    const rows = await db
      .select({
        kind: walletTxn.kind,
        balanceAfter: walletTxn.balanceAfter,
      })
      .from(walletTxn)
      .where(eq(walletTxn.churchId, CHURCH))
      .orderBy(desc(walletTxn.createdAt))
      .limit(2);

    // Newest first: the top-up landing on 6000, the advance that made it -4000.
    expect(Number(rows[0].balanceAfter)).toBe(6000);
    expect(Number(rows[1].balanceAfter)).toBe(-4000);
    expect(await getWalletBalance(CHURCH)).toBe(6000);
  });

  it("files the advance under its own category, not as an ordinary adjustment", async () => {
    await reset(0);
    await debitWallet({
      churchId: CHURCH,
      amount: 1500,
      category: "advance",
      allowNegative: true,
    });
    const [row] = await db
      .select({ category: walletTxn.category })
      .from(walletTxn)
      .where(eq(walletTxn.churchId, CHURCH))
      .orderBy(desc(walletTxn.createdAt))
      .limit(1);
    expect(row.category).toBe("advance");
  });
});
