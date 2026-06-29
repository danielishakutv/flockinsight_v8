import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, walletTxn } from "@/db/schema";

export type WalletCategory =
  | "topup"
  | "sms"
  | "storage"
  | "adjustment"
  | "refund";

const round = (n: number) => +n.toFixed(2);

/** Current unified wallet balance for a church. */
export async function getWalletBalance(churchId: string): Promise<number> {
  const [c] = await db
    .select({ balance: church.walletBalance })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  return Number(c?.balance ?? 0);
}

/** Add money to the wallet and record a ledger entry. Returns the new balance. */
export async function creditWallet(opts: {
  churchId: string;
  amount: number;
  category: WalletCategory;
  reason?: string;
  createdBy?: string | null;
}): Promise<number> {
  const amount = round(Math.max(0, opts.amount));
  if (amount <= 0) return getWalletBalance(opts.churchId);
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({ balance: church.walletBalance })
      .from(church)
      .where(eq(church.id, opts.churchId))
      .limit(1);
    const newBalance = round((c?.balance ?? 0) + amount);
    await tx
      .update(church)
      .set({ walletBalance: newBalance })
      .where(eq(church.id, opts.churchId));
    await tx.insert(walletTxn).values({
      churchId: opts.churchId,
      kind: "credit",
      category: opts.category,
      amount,
      balanceAfter: newBalance,
      reason: opts.reason,
      createdBy: opts.createdBy ?? undefined,
    });
    return newBalance;
  });
}

export type DebitResult =
  | { ok: true; balance: number }
  | { ok: false; error: string; balance: number };

/**
 * Take money from the wallet (if sufficient) and record a ledger entry.
 * Returns ok:false with the current balance when there isn't enough.
 */
export async function debitWallet(opts: {
  churchId: string;
  amount: number;
  category: WalletCategory;
  reason?: string;
  createdBy?: string | null;
}): Promise<DebitResult> {
  const amount = round(Math.max(0, opts.amount));
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({ balance: church.walletBalance })
      .from(church)
      .where(eq(church.id, opts.churchId))
      .limit(1);
    const balance = Number(c?.balance ?? 0);
    if (balance < amount) {
      return { ok: false, error: "Insufficient wallet balance.", balance };
    }
    const newBalance = round(balance - amount);
    await tx
      .update(church)
      .set({ walletBalance: newBalance })
      .where(eq(church.id, opts.churchId));
    await tx.insert(walletTxn).values({
      churchId: opts.churchId,
      kind: "debit",
      category: opts.category,
      amount,
      balanceAfter: newBalance,
      reason: opts.reason,
      createdBy: opts.createdBy ?? undefined,
    });
    return { ok: true, balance: newBalance };
  });
}
