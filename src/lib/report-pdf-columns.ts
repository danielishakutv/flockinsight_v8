/**
 * Deciding what a report PDF shows, and how wide each column is.
 *
 * Pure and free of `server-only` so it can be unit-tested. The rendering lives
 * in report-pdf.tsx; the judgement calls live here.
 */

/**
 * Is this column a database id?
 *
 * Ids are essential in the CSV — the export is designed to be joined on them,
 * and the Reports guide tells people to join on the id and never the name. But
 * in a PDF they are 36 characters of hex that nobody reads, and they crowd out
 * the columns that do matter. A printed member list wants names and phone
 * numbers, not UUIDs.
 */
export function isIdColumn(column: string): boolean {
  return /(^|_)id$/.test(column);
}

/** Column header → something readable: `member_name` → `Member name`. */
export function humanize(column: string): string {
  const s = column.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The columns a PDF should show, in order, as indexes into the full list. */
export function pdfColumns(columns: string[], max: number): number[] {
  return columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !isIdColumn(c))
    .slice(0, max)
    .map(({ i }) => i);
}

/**
 * How much width each column deserves.
 *
 * Every column having the same flex meant a date and a full postal address got
 * identical space: the address wrapped into an unreadable stack while the date
 * sat in a third of a column of white. Weight comes from the widest thing the
 * column actually has to show — header included — then clamped, so one long
 * note cannot squeeze everything else to nothing.
 */
export function columnWeights(
  columns: string[],
  rows: readonly (readonly (string | number | null)[])[],
  colIdx: number[],
  /** Sampling 200 rows is plenty to size a column, and keeps this cheap. */
  sampleRows = 200,
): number[] {
  return colIdx.map((i) => {
    const header = humanize(columns[i]).length;
    let widest = 0;
    const sample = Math.min(rows.length, sampleRows);
    for (let r = 0; r < sample; r++) {
      const v = rows[r][i];
      const len = v == null ? 0 : String(v).length;
      if (len > widest) widest = len;
    }
    // Headers render uppercase and bold, so they need more room per character.
    const need = Math.max(widest, header * 1.15);
    return Math.min(Math.max(need, 6), 26);
  });
}

/** Roughly how many characters fit in a column of this weight. */
export function cellLimit(weight: number): number {
  return Math.max(10, Math.round(weight * 2.2));
}

/** Keep a cell from blowing the column width apart. */
export function short(v: string | number | null, limit = 42): string {
  const s = v == null ? "" : String(v);
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
}
