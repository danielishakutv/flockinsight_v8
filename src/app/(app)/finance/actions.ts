"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  financeAccount,
  financeCategory,
  financeTransaction,
} from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import {
  defaultCategoriesFor,
  isIsoDate,
  parseAmount,
  type FinanceKind,
} from "@/lib/finance-shared";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

/**
 * Server actions for the finance module.
 *
 * Every one re-checks the church and the permission, and every write is scoped
 * by churchId as well as by id, so a guessed id from another church matches
 * nothing. Nothing here deletes a transaction as a side effect of anything
 * else: removing an account or a category leaves its rows in place.
 */
async function guard(): Promise<
  { ok: true; churchId: string; userId: string } | { ok: false; error: string }
> {
  const { church, user } = await requireChurch();
  if (!(await can("finance.manage"))) {
    return { ok: false, error: "You don't have permission to do that." };
  }
  return { ok: true, churchId: church.id, userId: user.id };
}

function refresh(): void {
  revalidatePath("/finance");
  revalidatePath("/finance/accounts");
  revalidatePath("/finance/categories");
  revalidatePath("/dashboard");
}

const KIND = z.enum(["income", "expense"]);
const uuid = z.string().uuid();

/* ============================================================
 * Accounts
 * ========================================================== */

const accountSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, "Give the account a name.").max(120),
  type: z.enum(["bank", "cash", "mobile_money", "other"]),
  institution: z.string().trim().max(120).optional(),
  accountNumber: z.string().trim().max(60).optional(),
  openingBalance: z.string().optional(),
  isActive: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});

export type AccountInput = z.input<typeof accountSchema>;

export async function saveAccount(input: AccountInput): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;

  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the details and try again.",
    };
  }
  const d = parsed.data;

  // An opening balance is optional, and unlike a transaction amount it may
  // legitimately be zero or negative (an overdrawn account is still a fact).
  let openingBalance = 0;
  if (d.openingBalance?.trim()) {
    const cleaned = d.openingBalance.replace(/[^\d.-]/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n) || Math.abs(n) >= 1e12) {
      return { ok: false, error: "That opening balance isn't a valid amount." };
    }
    openingBalance = Math.round(n * 100) / 100;
  }

  const values = {
    name: d.name,
    type: d.type,
    institution: d.institution || null,
    accountNumber: d.accountNumber || null,
    openingBalance,
    isActive: d.isActive ?? true,
    note: d.note || null,
  };

  try {
    if (d.id) {
      const [row] = await db
        .update(financeAccount)
        .set(values)
        .where(
          and(
            eq(financeAccount.id, d.id),
            eq(financeAccount.churchId, g.churchId),
          ),
        )
        .returning({ id: financeAccount.id });
      if (!row) return { ok: false, error: "That account no longer exists." };
      refresh();
      return { ok: true, id: row.id };
    }

    const [row] = await db
      .insert(financeAccount)
      .values({ churchId: g.churchId, ...values, createdBy: g.userId })
      .returning({ id: financeAccount.id });
    refresh();
    return { ok: true, id: row.id };
  } catch (e) {
    // The unique index on (church, name) is the likely cause; say so plainly
    // rather than showing a database error.
    if (isUniqueViolation(e)) {
      return { ok: false, error: "You already have an account with that name." };
    }
    console.error("saveAccount failed", e);
    return { ok: false, error: "Could not save the account." };
  }
}

/**
 * Retire an account without touching its history.
 *
 * Deliberately not a delete: the transactions recorded against it are the
 * church's financial record. A closed account drops out of the pickers and can
 * be reopened.
 */
export async function setAccountActive(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid id" };

  const [row] = await db
    .update(financeAccount)
    .set({ isActive })
    .where(
      and(eq(financeAccount.id, id), eq(financeAccount.churchId, g.churchId)),
    )
    .returning({ id: financeAccount.id });
  if (!row) return { ok: false, error: "That account no longer exists." };
  refresh();
  return { ok: true, id: row.id };
}

/**
 * Remove an account outright. Only allowed while nothing has been recorded
 * against it — otherwise the honest action is to close it, and we say so.
 */
export async function deleteAccount(id: string): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid id" };

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(financeTransaction)
    .where(
      and(
        eq(financeTransaction.accountId, id),
        eq(financeTransaction.churchId, g.churchId),
      ),
    );

  if (Number(count) > 0) {
    return {
      ok: false,
      error: `This account has ${count} record${Number(count) === 1 ? "" : "s"} against it. Close it instead — that keeps the history.`,
    };
  }

  const [row] = await db
    .delete(financeAccount)
    .where(
      and(eq(financeAccount.id, id), eq(financeAccount.churchId, g.churchId)),
    )
    .returning({ id: financeAccount.id });
  if (!row) return { ok: false, error: "That account no longer exists." };
  refresh();
  return { ok: true, id: row.id };
}

/* ============================================================
 * Categories
 * ========================================================== */

const categorySchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, "Give the category a name.").max(120),
  kind: KIND,
  isActive: z.boolean().optional(),
});

export type CategoryInput = z.input<typeof categorySchema>;

export async function saveCategory(input: CategoryInput): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;

  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the details and try again.",
    };
  }
  const d = parsed.data;

  try {
    if (d.id) {
      // The kind is fixed after creation: flipping it would move existing
      // records from one side of the books to the other without anyone asking.
      const [row] = await db
        .update(financeCategory)
        .set({ name: d.name, isActive: d.isActive ?? true })
        .where(
          and(
            eq(financeCategory.id, d.id),
            eq(financeCategory.churchId, g.churchId),
          ),
        )
        .returning({ id: financeCategory.id });
      if (!row) return { ok: false, error: "That category no longer exists." };
      refresh();
      return { ok: true, id: row.id };
    }

    const [row] = await db
      .insert(financeCategory)
      .values({
        churchId: g.churchId,
        name: d.name,
        kind: d.kind,
        isActive: d.isActive ?? true,
      })
      .returning({ id: financeCategory.id });
    refresh();
    return { ok: true, id: row.id };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return {
        ok: false,
        error: `You already have a ${d.kind} category called "${d.name}".`,
      };
    }
    console.error("saveCategory failed", e);
    return { ok: false, error: "Could not save the category." };
  }
}

export async function setCategoryActive(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid id" };

  const [row] = await db
    .update(financeCategory)
    .set({ isActive })
    .where(
      and(eq(financeCategory.id, id), eq(financeCategory.churchId, g.churchId)),
    )
    .returning({ id: financeCategory.id });
  if (!row) return { ok: false, error: "That category no longer exists." };
  refresh();
  return { ok: true, id: row.id };
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid id" };

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(financeTransaction)
    .where(
      and(
        eq(financeTransaction.categoryId, id),
        eq(financeTransaction.churchId, g.churchId),
      ),
    );

  if (Number(count) > 0) {
    return {
      ok: false,
      error: `This category is used by ${count} record${Number(count) === 1 ? "" : "s"}. Retire it instead — that keeps them labelled.`,
    };
  }

  const [row] = await db
    .delete(financeCategory)
    .where(
      and(eq(financeCategory.id, id), eq(financeCategory.churchId, g.churchId)),
    )
    .returning({ id: financeCategory.id });
  if (!row) return { ok: false, error: "That category no longer exists." };
  refresh();
  return { ok: true, id: row.id };
}

/** One-tap setup: add the starting categories a church doesn't already have. */
export async function createDefaultCategories(
  kind: FinanceKind,
): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!KIND.safeParse(kind).success) return { ok: false, error: "Invalid kind" };

  try {
    await db
      .insert(financeCategory)
      .values(
        defaultCategoriesFor(kind).map((name) => ({
          churchId: g.churchId,
          name,
          kind,
        })),
      )
      // Adding these twice should be harmless, not an error.
      .onConflictDoNothing();
    refresh();
    return { ok: true };
  } catch (e) {
    console.error("createDefaultCategories failed", e);
    return { ok: false, error: "Could not add the starting categories." };
  }
}

/* ============================================================
 * Transactions
 * ========================================================== */

const transactionSchema = z.object({
  id: uuid.optional(),
  kind: KIND,
  amount: z.string().min(1, "Enter an amount."),
  date: z.string().refine(isIsoDate, "Pick a valid date."),
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
  party: z.string().trim().max(160).optional(),
  reference: z.string().trim().max(120).optional(),
  method: z.string().optional(),
  note: z.string().trim().max(1000).optional(),
});

export type TransactionInput = z.input<typeof transactionSchema>;

const METHODS = new Set([
  "cash",
  "transfer",
  "card",
  "cheque",
  "online",
  "other",
]);

export async function saveTransaction(
  input: TransactionInput,
): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;

  const parsed = transactionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the details and try again.",
    };
  }
  const d = parsed.data;

  const amount = parseAmount(d.amount);
  if (amount === null) {
    return { ok: false, error: "Enter an amount greater than zero." };
  }

  // An account or category from another church must not be attachable, so both
  // are confirmed to belong here before they are stored.
  const accountId = d.accountId && uuid.safeParse(d.accountId).success ? d.accountId : null;
  if (accountId) {
    const [a] = await db
      .select({ id: financeAccount.id })
      .from(financeAccount)
      .where(
        and(
          eq(financeAccount.id, accountId),
          eq(financeAccount.churchId, g.churchId),
        ),
      )
      .limit(1);
    if (!a) return { ok: false, error: "That account no longer exists." };
  }

  const categoryId =
    d.categoryId && uuid.safeParse(d.categoryId).success ? d.categoryId : null;
  if (categoryId) {
    const [c] = await db
      .select({ id: financeCategory.id, kind: financeCategory.kind })
      .from(financeCategory)
      .where(
        and(
          eq(financeCategory.id, categoryId),
          eq(financeCategory.churchId, g.churchId),
        ),
      )
      .limit(1);
    if (!c) return { ok: false, error: "That category no longer exists." };
    // An expense filed under an income category would quietly corrupt every
    // breakdown that groups by category.
    if (c.kind !== d.kind) {
      return {
        ok: false,
        error: `That category is for ${c.kind}, but this is ${d.kind === "income" ? "an income" : "an expense"} record.`,
      };
    }
  }

  const values = {
    kind: d.kind,
    amount,
    date: d.date,
    accountId,
    categoryId,
    party: d.party || null,
    reference: d.reference || null,
    method: d.method && METHODS.has(d.method) ? (d.method as "cash") : null,
    note: d.note || null,
  };

  try {
    if (d.id) {
      const [row] = await db
        .update(financeTransaction)
        .set(values)
        .where(
          and(
            eq(financeTransaction.id, d.id),
            eq(financeTransaction.churchId, g.churchId),
          ),
        )
        .returning({ id: financeTransaction.id });
      if (!row) return { ok: false, error: "That record no longer exists." };
      refresh();
      return { ok: true, id: row.id };
    }

    const [row] = await db
      .insert(financeTransaction)
      .values({ churchId: g.churchId, ...values, recordedBy: g.userId })
      .returning({ id: financeTransaction.id });
    refresh();
    return { ok: true, id: row.id };
  } catch (e) {
    console.error("saveTransaction failed", e);
    return { ok: false, error: "Could not save the record." };
  }
}

export async function deleteTransaction(id: string): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid id" };

  try {
    const [row] = await db
      .delete(financeTransaction)
      .where(
        and(
          eq(financeTransaction.id, id),
          eq(financeTransaction.churchId, g.churchId),
        ),
      )
      .returning({ id: financeTransaction.id });
    if (!row) return { ok: false, error: "That record no longer exists." };
    refresh();
    return { ok: true, id: row.id };
  } catch (e) {
    console.error("deleteTransaction failed", e);
    return { ok: false, error: "Could not delete the record." };
  }
}

/** Postgres reports a duplicate key as 23505; anything else is a real failure. */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "23505"
  );
}
