/**
 * Recognising gifts that are already in the ledger, so a giving file imported
 * twice does not double the money.
 *
 * Every row used to be inserted. A retry after the response was lost once the
 * transaction had committed, or next month's file overlapping this month's,
 * added every gift again — and the giving totals, the statements, the project
 * progress and the mirrored Finance fund balances all doubled with it.
 *
 * WHY THIS COUNTS RATHER THAN ASKING "IS IT THERE?". Identical gifts are
 * normal: two anonymous ₦1,000 cash offerings on one Sunday share every
 * field we have. A rule that skipped any row whose key was already seen would
 * drop the second of them on a first import — real money silently missing.
 * So the ledger is counted per key, and each row already there uses up one of
 * that count. Importing a file twice adds nothing the second time; a file that
 * holds two identical gifts imports both.
 *
 * No database in here, so the decisions can be tested on their own.
 */

export type GiftKeyParts = {
  date: string;
  amount: number;
  /** As the export writes it: the member's name, else the typed giver. */
  giver: string | null;
  categoryId: string | null;
  projectId: string | null;
  method: string | null;
  note: string | null;
};

/**
 * One gift, as a key. Text is compared the way the import stores it — trimmed
 * and clipped to the same lengths — and without case, so a file that went out
 * and came back through a spreadsheet still finds the gift it came from.
 */
export function giftKey(g: GiftKeyParts): string {
  return JSON.stringify([
    g.date,
    // Cents, so 5000 and 5000.00 are one amount.
    Math.round(g.amount * 100),
    (g.giver ?? "").trim().slice(0, 160).toLowerCase(),
    g.categoryId ?? "",
    g.projectId ?? "",
    g.method ?? "",
    (g.note ?? "").trim().slice(0, 500).toLowerCase(),
  ]);
}

/** How many of each gift the ledger already holds. */
export function countGifts(gifts: GiftKeyParts[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const g of gifts) {
    const k = giftKey(g);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/**
 * Split a file's rows into gifts to add and gifts already recorded, in file
 * order. Each row that matches uses up one gift on file; once those are used
 * up, further identical rows are new gifts. `onFile` is not changed.
 */
export function splitAlreadyRecorded<T>(
  rows: T[],
  keyOf: (row: T) => string,
  onFile: Map<string, number>,
): { add: T[]; already: T[] } {
  const left = new Map(onFile);
  const add: T[] = [];
  const already: T[] = [];
  for (const row of rows) {
    const k = keyOf(row);
    const n = left.get(k) ?? 0;
    if (n > 0) {
      left.set(k, n - 1);
      already.push(row);
    } else {
      add.push(row);
    }
  }
  return { add, already };
}
