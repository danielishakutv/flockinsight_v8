import "server-only";
import { and, eq, gte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, smsTopup, walletTopup, walletTxn } from "@/db/schema";
import { paystackVerify } from "@/lib/paystack";
import { classifyCharge, type SettleResult } from "@/lib/paystack-outcome";

export type WalletCategory =
  | "topup"
  | "sms"
  | "storage"
  | "advance"
  | "adjustment"
  | "refund";

/** An open transaction, for callers that must move money alongside other writes. */
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const round = (n: number) => +n.toFixed(2);

/*
 * EVERY balance change here is one statement: `wallet_balance = wallet_balance
 * ± amount ... returning wallet_balance`.
 *
 * Both functions used to read the balance, work out the new figure in
 * JavaScript, and write that absolute number back. Under READ COMMITTED two of
 * those running at once both read the same starting balance and the second
 * write erases the first: a top-up that landed while an SMS batch was being
 * charged vanished, and two debits that each fitted on their own both passed
 * a check that together they should have failed. The ledger kept both rows, so
 * the running balance stopped agreeing with the balance — silently.
 *
 * An UPDATE that does the arithmetic in the database takes the row lock and
 * re-reads the row it is changing, so concurrent movements queue behind each
 * other instead of overwriting each other. `balanceAfter` comes from what the
 * UPDATE returned, never from a figure computed before it.
 *
 * (The raw `sql` here has no join, so it renders as an unqualified
 * "wallet_balance" — which is exactly right in an UPDATE of `church`. The
 * AGENTS.md qualifier trap is about correlated subqueries, not SET clauses.)
 */

/** Current unified wallet balance for a church. */
export async function getWalletBalance(
  churchId: string,
  tx: DbTx | typeof db = db,
): Promise<number> {
  const [c] = await tx
    .select({ balance: church.walletBalance })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  return Number(c?.balance ?? 0);
}

export type CreditOptions = {
  churchId: string;
  amount: number;
  category: WalletCategory;
  reason?: string;
  createdBy?: string | null;
  /**
   * The external payment this credit settles (a Paystack reference). A second
   * credit carrying the same reference changes nothing and reports the
   * current balance — the unique index on wallet_txn.reference is what makes
   * that true even for two requests arriving at the same instant.
   */
  reference?: string | null;
};

export type CreditResult = { balance: number; credited: boolean };

async function creditIn(tx: DbTx, opts: CreditOptions): Promise<CreditResult> {
  const amount = round(Math.max(0, opts.amount));
  if (amount <= 0)
    return { balance: await getWalletBalance(opts.churchId, tx), credited: false };

  /*
   * The ledger row goes in FIRST when there is a reference, because the
   * unique index is the idempotency check. A concurrent insert of the same
   * reference blocks on the index until this transaction ends, then does
   * nothing — so only one of them ever reaches the balance.
   */
  let ledgerId: string | null = null;
  if (opts.reference) {
    const [row] = await tx
      .insert(walletTxn)
      .values({
        churchId: opts.churchId,
        kind: "credit",
        category: opts.category,
        amount,
        balanceAfter: 0, // set below, from what the UPDATE returns
        reason: opts.reason,
        createdBy: opts.createdBy ?? undefined,
        reference: opts.reference,
      })
      .onConflictDoNothing()
      .returning({ id: walletTxn.id });
    if (!row)
      return { balance: await getWalletBalance(opts.churchId, tx), credited: false };
    ledgerId = row.id;
  }

  const [updated] = await tx
    .update(church)
    .set({
      walletBalance: sql`round((${church.walletBalance} + ${amount}::numeric), 2)`,
    })
    .where(eq(church.id, opts.churchId))
    .returning({ balance: church.walletBalance });
  // No church, no credit. Throwing rolls back the ledger row above with it.
  if (!updated) throw new Error(`creditWallet: church ${opts.churchId} not found`);
  const balance = Number(updated.balance);

  if (ledgerId) {
    await tx
      .update(walletTxn)
      .set({ balanceAfter: balance })
      .where(eq(walletTxn.id, ledgerId));
  } else {
    await tx.insert(walletTxn).values({
      churchId: opts.churchId,
      kind: "credit",
      category: opts.category,
      amount,
      balanceAfter: balance,
      reason: opts.reason,
      createdBy: opts.createdBy ?? undefined,
    });
  }
  return { balance, credited: true };
}

/**
 * Add money to the wallet and record a ledger entry. Returns the new balance.
 *
 * Pass `tx` to make the credit part of a larger write — a top-up's claim and
 * its credit must commit or fail together, or a crash between them leaves a
 * payment marked paid that never reached the wallet.
 */
export async function creditWallet(opts: CreditOptions, tx?: DbTx): Promise<number> {
  const res = tx ? await creditIn(tx, opts) : await db.transaction((t) => creditIn(t, opts));
  return res.balance;
}

/** As creditWallet, but says whether this call is the one that credited. */
export async function creditWalletOnce(
  opts: CreditOptions,
  tx?: DbTx,
): Promise<CreditResult> {
  return tx ? creditIn(tx, opts) : db.transaction((t) => creditIn(t, opts));
}

export type DebitResult =
  | { ok: true; balance: number }
  | { ok: false; error: string; balance: number };

export type DebitOptions = {
  churchId: string;
  amount: number;
  category: WalletCategory;
  reason?: string;
  createdBy?: string | null;
  allowNegative?: boolean;
};

async function debitIn(tx: DbTx, opts: DebitOptions): Promise<DebitResult> {
  const amount = round(Math.max(0, opts.amount));
  /*
   * Lock the church row FIRST, then check in the UPDATE's WHERE.
   *
   * The WHERE alone is not enough, and the way it fails is quiet. Under READ
   * COMMITTED an UPDATE only waits for, and re-checks, rows that matched its
   * WHERE in the statement's starting snapshot. A top-up still in flight is
   * not in that snapshot, so the row "has ₦1,000" and fails `>= 3000` — and
   * the UPDATE skips it without waiting for the credit to commit. The church
   * is told its wallet is short while ₦6,000 is landing in it.
   *
   * `FOR UPDATE` waits for whoever holds the row, and the UPDATE after it is a
   * new statement with a new snapshot, so the check sees the committed
   * balance. The predicate stays in the WHERE so a concurrent DEBIT still
   * cannot spend the same money twice. wallet.db-check.ts holds both cases.
   */
  await tx
    .select({ id: church.id })
    .from(church)
    .where(eq(church.id, opts.churchId))
    .for("update");
  const [updated] = await tx
    .update(church)
    .set({
      walletBalance: sql`round((${church.walletBalance} - ${amount}::numeric), 2)`,
    })
    .where(
      opts.allowNegative
        ? eq(church.id, opts.churchId)
        : and(eq(church.id, opts.churchId), gte(church.walletBalance, amount)),
    )
    .returning({ balance: church.walletBalance });
  if (!updated) {
    return {
      ok: false,
      error: "Insufficient wallet balance.",
      balance: await getWalletBalance(opts.churchId, tx),
    };
  }
  const balance = Number(updated.balance);
  await tx.insert(walletTxn).values({
    churchId: opts.churchId,
    kind: "debit",
    category: opts.category,
    amount,
    balanceAfter: balance,
    reason: opts.reason,
    createdBy: opts.createdBy ?? undefined,
  });
  return { ok: true, balance };
}

/**
 * Take money from the wallet (if sufficient) and record a ledger entry.
 * Returns ok:false with the current balance when there isn't enough.
 *
 * `allowNegative` lets the balance go below zero — an advance, settled by the
 * church's next top-up. It exists for one caller: a superadmin deliberately
 * extending credit. Everything a church can trigger itself (SMS, storage) must
 * leave it off, or any church could run up a debt by spending money it does
 * not have, which is not a credit line so much as an accident.
 *
 * Pass `tx` to make the debit part of a larger write (a storage switch charges
 * and changes the quota together, or neither).
 */
export async function debitWallet(opts: DebitOptions, tx?: DbTx): Promise<DebitResult> {
  return tx ? debitIn(tx, opts) : db.transaction((t) => debitIn(t, opts));
}

/**
 * Settle a wallet top-up by asking Paystack what happened, and credit it once.
 *
 * Every path that credits a Paystack top-up comes through here — the browser
 * callback, the webhook and the reconcile cron — because each of them on its
 * own used to read "pending", verify, and credit: two arriving together (a
 * refresh, a retried redirect, the webhook racing the browser) credited the
 * same payment twice. And a payer whose browser never came back was never
 * credited at all.
 *
 * The claim is a conditional UPDATE ... RETURNING that only one caller can
 * win, in the SAME transaction as the credit — so the row is never marked
 * paid without the money reaching the wallet, or the other way round — and
 * the credit carries the reference, which wallet_txn holds unique as the last
 * line of defence.
 *
 * `sms` is the legacy SMS-only top-up table; its money lands in the same
 * unified wallet.
 */
export async function settleTopup(
  kind: "wallet" | "sms",
  reference: string,
): Promise<SettleResult> {
  const table = kind === "wallet" ? walletTopup : smsTopup;
  const [t] = await db
    .select({
      id: table.id,
      churchId: table.churchId,
      amount: table.amount,
      status: table.status,
      createdBy: table.createdBy,
    })
    .from(table)
    .where(eq(table.reference, reference))
    .limit(1);
  if (!t) return "not-found";
  if (t.status === "success") return "already";

  const v = await paystackVerify(reference);
  const outcome = classifyCharge(v, Number(t.amount));
  if (outcome === "unknown") {
    console.warn(`[wallet] could not verify top-up ${reference}`, v.ok ? null : v.error);
    return "unknown";
  }
  if (outcome === "pending") return "pending";
  if (outcome === "mismatch") {
    console.error(
      `[wallet] top-up ${reference}: Paystack reports ${v.ok ? `${v.amountKobo / 100} ${v.currency}` : "?"}, expected ₦${Number(t.amount)} — not credited`,
    );
    return "mismatch";
  }
  if (outcome === "failed") {
    // Pending only: a late "abandoned" must never overwrite a success.
    await db
      .update(table)
      .set({ status: "failed" })
      .where(and(eq(table.id, t.id), eq(table.status, "pending")));
    return "failed";
  }

  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(table)
      .set({ status: "success", paidAt: new Date() })
      .where(and(eq(table.id, t.id), ne(table.status, "success")))
      .returning({ id: table.id });
    if (claimed.length !== 1) return "already" as const;
    const res = await creditIn(tx, {
      churchId: t.churchId,
      amount: Number(t.amount),
      category: "topup",
      reason: "Wallet top-up (Paystack)",
      createdBy: t.createdBy,
      reference,
    });
    return res.credited ? ("success" as const) : ("already" as const);
  });
}
