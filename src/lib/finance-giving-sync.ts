import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  financeAccount,
  financeCategory,
  financeTransaction,
  giving,
  givingCategory,
  member,
} from "@/db/schema";

/**
 * Keeping a giving fund's books in step with the giving itself.
 *
 * A finance account linked to a giving category is that category's fund. Every
 * gift in the category writes one income row here, tagged with the gift's id,
 * and that row is the gift's shadow: edit the gift and the row follows, remove
 * the gift and the row goes with it.
 *
 * The traffic is one-way. Nothing here ever writes back to a giving record —
 * giving says what was given, and is not a financial ledger. What the fund has
 * left after spending lives only in Finance.
 */

/** The finance account acting as a category's fund, if one is linked. */
export async function fundAccountFor(
  churchId: string,
  categoryId: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: financeAccount.id, name: financeAccount.name })
    .from(financeAccount)
    .where(
      and(
        eq(financeAccount.churchId, churchId),
        eq(financeAccount.givingCategoryId, categoryId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The finance income category a fund's rows are filed under, created if it is
 * not there yet.
 *
 * Without one every gift would land in the ledger as "Uncategorised", and the
 * breakdown — the thing a treasurer actually reads — would be useless. The
 * name matches the giving category so the two read as the same thing.
 */
async function ensureIncomeCategory(
  churchId: string,
  name: string,
): Promise<string | null> {
  const [existing] = await db
    .select({ id: financeCategory.id })
    .from(financeCategory)
    .where(
      and(
        eq(financeCategory.churchId, churchId),
        eq(financeCategory.kind, "income"),
        eq(financeCategory.name, name),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(financeCategory)
    .values({ churchId, name, kind: "income" })
    .onConflictDoNothing()
    .returning({ id: financeCategory.id });
  if (created) return created.id;

  // Lost a race with a concurrent insert — read back the winner.
  const [after] = await db
    .select({ id: financeCategory.id })
    .from(financeCategory)
    .where(
      and(
        eq(financeCategory.churchId, churchId),
        eq(financeCategory.kind, "income"),
        eq(financeCategory.name, name),
      ),
    )
    .limit(1);
  return after?.id ?? null;
}

/** Everything a shadow row needs, read from the gift in one go. */
async function giftDetail(churchId: string, givingId: string) {
  const [row] = await db
    .select({
      id: giving.id,
      amount: giving.amount,
      date: giving.date,
      method: giving.method,
      note: giving.note,
      recordedBy: giving.recordedBy,
      giverName: giving.giverName,
      firstName: member.firstName,
      lastName: member.lastName,
      categoryId: giving.categoryId,
      categoryName: givingCategory.name,
    })
    .from(giving)
    .leftJoin(member, eq(member.id, giving.memberId))
    .leftJoin(givingCategory, eq(givingCategory.id, giving.categoryId))
    .where(and(eq(giving.id, givingId), eq(giving.churchId, churchId)))
    .limit(1);
  return row ?? null;
}

function giverLabel(row: {
  firstName: string | null;
  lastName: string | null;
  giverName: string | null;
}): string | null {
  const name = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
  return name || row.giverName || null;
}

/**
 * Bring one gift's shadow row in line with the gift.
 *
 * Creates it, updates it, or removes it when the gift no longer belongs to a
 * category with a fund — someone moved it to another category, or the fund was
 * unlinked. Removing a shadow is not losing a record: the gift itself is
 * untouched, and the row only ever existed as its reflection.
 *
 * Best-effort by design. The gift is already saved by the time this runs, and
 * a failure to mirror it must never undo that.
 */
export async function syncGivingToFinance(
  churchId: string,
  givingId: string,
): Promise<void> {
  try {
    const gift = await giftDetail(churchId, givingId);
    const fund = gift?.categoryId
      ? await fundAccountFor(churchId, gift.categoryId)
      : null;

    if (!gift || !fund) {
      await db
        .delete(financeTransaction)
        .where(
          and(
            eq(financeTransaction.givingId, givingId),
            eq(financeTransaction.churchId, churchId),
          ),
        );
      return;
    }

    const categoryId = gift.categoryName
      ? await ensureIncomeCategory(churchId, gift.categoryName)
      : null;

    const values = {
      kind: "income" as const,
      amount: Number(gift.amount ?? 0),
      date: gift.date,
      accountId: fund.id,
      categoryId,
      party: giverLabel(gift),
      method: gift.method,
      note: gift.note,
      recordedBy: gift.recordedBy,
    };

    const [existing] = await db
      .select({ id: financeTransaction.id })
      .from(financeTransaction)
      .where(
        and(
          eq(financeTransaction.givingId, givingId),
          eq(financeTransaction.churchId, churchId),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(financeTransaction)
        .set(values)
        .where(eq(financeTransaction.id, existing.id));
      return;
    }

    await db
      .insert(financeTransaction)
      .values({ churchId, givingId, ...values });
  } catch (e) {
    console.error("syncGivingToFinance failed", { givingId }, e);
  }
}

/** What linking a category to a new fund would pull in, for the confirmation. */
export async function backfillPreview(
  churchId: string,
  categoryId: string,
): Promise<{ count: number; total: number }> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)`,
      total: sql<number>`coalesce(sum(${giving.amount}), 0)`,
    })
    .from(giving)
    .where(
      and(eq(giving.churchId, churchId), eq(giving.categoryId, categoryId)),
    );
  return { count: Number(row?.count ?? 0), total: Number(row?.total ?? 0) };
}

/**
 * Write a shadow row for every gift already in the category.
 *
 * Runs once, when the fund is first linked, so the balance reflects everything
 * ever given rather than starting blank. Only gifts without a shadow are
 * touched, so running it twice adds nothing.
 *
 * Done in one INSERT ... SELECT rather than a row at a time: a category with
 * years of giving can hold thousands of gifts, and a per-row round trip would
 * take minutes and leave a half-built fund behind if it failed midway.
 */
export async function backfillFund(
  churchId: string,
  categoryId: string,
  accountId: string,
  categoryName: string,
): Promise<number> {
  const financeCategoryId = await ensureIncomeCategory(churchId, categoryName);

  // Written as one INSERT ... SELECT. Drizzle's insert-select cannot carry the
  // literals and the enum cast this needs, and doing it row by row would mean
  // thousands of round trips for a category with years of giving.
  //
  // giving_method and finance_method hold the same six values but are separate
  // Postgres types, so the method goes through text. Every value below is a
  // bound parameter.
  const result = await db.execute(sql`
    insert into finance_transaction
      (church_id, kind, amount, date, account_id, category_id,
       party, method, note, giving_id, recorded_by)
    select
      g.church_id,
      'income'::finance_kind,
      g.amount,
      g.date,
      ${accountId}::uuid,
      ${financeCategoryId}::uuid,
      coalesce(
        nullif(trim(concat_ws(' ', m.first_name, m.last_name)), ''),
        g.giver_name
      ),
      g.method::text::finance_method,
      g.note,
      g.id,
      g.recorded_by
    from giving g
    left join member m on m.id = g.member_id
    -- Only gifts that have no shadow yet, so a second run adds nothing.
    left join finance_transaction ft on ft.giving_id = g.id
    where g.church_id = ${churchId}
      and g.category_id = ${categoryId}::uuid
      and ft.id is null
  `);

  return Number(result.rowCount ?? 0);
}
