/**
 * Database-backed checks for wallet money movement. Run with `pnpm test:db`.
 *
 * Every balance change used to be "read the balance, work out the new figure
 * in JavaScript, write that number back" — under READ COMMITTED, two of those
 * at once both read the same balance and the second write erased the first.
 * And a Paystack top-up was credited by whichever of the callback, a refresh
 * or the webhook got there, as many times as they arrived.
 *
 * `Promise.all` that happens to serialise proves nothing here (AGENTS.md), so
 * each race below is DELIBERATELY interleaved: one transaction takes the row
 * and holds it open while the other is started against the same row.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, walletTopup, walletTxn } from "@/db/schema";

// Paystack is asked "did this succeed?" — answer yes, for exactly ₦5,000.
vi.mock("@/lib/paystack", () => ({
  paystackVerify: async () => ({ ok: true, status: "success", amountKobo: 500_000, currency: "NGN" }),
  paystackInit: async () => ({ ok: false, error: "not in a db-check" }),
  isPaystackConfigured: () => true,
  paystackSignatureValid: () => false,
}));

const { creditWallet, creditWalletOnce, debitWallet, getWalletBalance, settleTopup } =
  await import("@/lib/wallet");

const stamp = Date.now();
const CHURCH = `zzcheck-wallet-${stamp}`;
const TOPUP_REF = `WAL-zzcheck-${stamp}`;
let topupId: string | null = null;

beforeAll(async () => {
  await db.insert(church).values({
    id: CHURCH,
    name: `ZZ Wallet ${stamp}`,
    slug: `zzcheck-wallet-${stamp}`,
    handle: `zzcheck-wallet-${stamp}`,
    walletBalance: 0,
  });
  const [t] = await db
    .insert(walletTopup)
    .values({ churchId: CHURCH, amount: 5000, reference: TOPUP_REF })
    .returning({ id: walletTopup.id });
  topupId = t.id;
});

afterAll(async () => {
  // Only what this file made, by id.
  if (topupId) await db.delete(walletTopup).where(eq(walletTopup.id, topupId));
  await db.delete(walletTxn).where(eq(walletTxn.churchId, CHURCH));
  await db.delete(church).where(eq(church.id, CHURCH));
});

async function reset(to: number) {
  await db.update(church).set({ walletBalance: to }).where(eq(church.id, CHURCH));
}

/** A promise and the function that resolves it. */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ledgerSum(): Promise<number> {
  const rows = await db
    .select({ kind: walletTxn.kind, amount: walletTxn.amount })
    .from(walletTxn)
    .where(eq(walletTxn.churchId, CHURCH));
  return rows.reduce((s, r) => s + (r.kind === "credit" ? 1 : -1) * Number(r.amount), 0);
}

describe("concurrent wallet movements", () => {
  it("refuses the second of two debits that only fit one at a time", async () => {
    await reset(5000);
    const held = gate();
    const took = gate();
    // T1 debits ₦3,000 and holds its transaction open.
    const t1 = db.transaction(async (tx) => {
      const r = await debitWallet({ churchId: CHURCH, amount: 3000, category: "sms" }, tx);
      took.open();
      await held.p;
      return r;
    });
    await took.p;
    // T2 asks for ₦2,500 against the same row while T1 is uncommitted. The
    // old code read ₦5,000 here, passed, and wrote ₦2,500 over T1's ₦2,000.
    const t2 = debitWallet({ churchId: CHURCH, amount: 2500, category: "storage" });
    await pause(300);
    held.open();
    const [r1, r2] = await Promise.all([t1, t2]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(await getWalletBalance(CHURCH)).toBe(2000);
  });

  it("never loses a credit that lands while a debit is in flight", async () => {
    await reset(1000);
    const before = await ledgerSum();
    const held = gate();
    const took = gate();
    const t1 = db.transaction(async (tx) => {
      await creditWallet({ churchId: CHURCH, amount: 5000, category: "topup" }, tx);
      took.open();
      await held.p;
    });
    await took.p;
    const t2 = debitWallet({ churchId: CHURCH, amount: 3000, category: "sms" });
    await pause(300);
    held.open();
    const [, r2] = await Promise.all([t1, t2]);

    expect(r2.ok).toBe(true);
    expect(await getWalletBalance(CHURCH)).toBe(3000);
    // The ledger moved by exactly what the balance moved by.
    expect((await ledgerSum()) - before).toBe(2000);
  });

  it("credits one external reference once, however many arrive together", async () => {
    await reset(0);
    const ref = `zzcheck-ref-${stamp}`;
    const held = gate();
    const took = gate();
    const t1 = db.transaction(async (tx) => {
      const r = await creditWalletOnce(
        { churchId: CHURCH, amount: 700, category: "topup", reference: ref },
        tx,
      );
      took.open();
      await held.p;
      return r;
    });
    await took.p;
    // Blocks on the unique index until T1 commits, then does nothing.
    const t2 = creditWalletOnce({ churchId: CHURCH, amount: 700, category: "topup", reference: ref });
    await pause(300);
    held.open();
    const [r1, r2] = await Promise.all([t1, t2]);

    expect([r1.credited, r2.credited].filter(Boolean)).toHaveLength(1);
    expect(await getWalletBalance(CHURCH)).toBe(700);
  });
});

describe("settleTopup", () => {
  it("credits a Paystack top-up once, whoever reports it and however often", async () => {
    await reset(0);
    // The callback, a refresh, the webhook and the cron, all at once.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => settleTopup("wallet", TOPUP_REF)),
    );
    expect(results.filter((r) => r === "success")).toHaveLength(1);
    expect(results.every((r) => r === "success" || r === "already")).toBe(true);
    expect(await getWalletBalance(CHURCH)).toBe(5000);

    // And again later, after it has settled.
    expect(await settleTopup("wallet", TOPUP_REF)).toBe("already");
    expect(await getWalletBalance(CHURCH)).toBe(5000);

    const [t] = await db
      .select({ status: walletTopup.status })
      .from(walletTopup)
      .where(eq(walletTopup.reference, TOPUP_REF));
    expect(t.status).toBe("success");
  });
});
