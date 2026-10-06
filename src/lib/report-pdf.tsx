import "server-only";
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { format } from "date-fns";
import type { DatasetResult } from "@/lib/report-data";
import type { ChurchTotals } from "@/lib/report-data";
import { CATEGORIES, type Dataset } from "@/lib/report-catalog";
import { rangeLabel, type ReportRange } from "@/lib/report-range";
import {
  CHANNEL_LABEL,
  monthLabel,
  STATUS_LABEL,
  type AttendanceByService,
  type ChannelRow,
  type GivingByCategory,
  type GroupSize,
  type MonthRow,
  type StatusCount,
  type SummaryInsights,
} from "@/lib/report-summary";
import { BrandBand, BrandFooter } from "@/lib/pdf-chrome";
import type { ChurchBrand } from "@/lib/pdf-brand";
import {
  cellLimit,
  columnWeights,
  humanize,
  isIdColumn,
  pdfColumns,
  short,
} from "@/lib/report-pdf-columns";
import { PDF_FONT } from "@/lib/pdf-font";

/**
 * PDFs for the report centre: one generic table renderer that works for any
 * dataset, plus a summary cover report.
 *
 * The palette and header band are copied from `attendance-pdf.tsx` on purpose
 * — a church that has seen one FlockInsight PDF should recognise the next.
 *
 * A PDF is for reading and circulating, not for analysis, so wide datasets are
 * trimmed to the columns that fit and long ones are cut off with a visible
 * note. The CSV is the complete artefact and the page says so.
 */

const C = {
  primary: "#6d28d9",
  white: "#ffffff",
  whiteSoft: "rgba(255,255,255,0.72)",
  whiteBox: "rgba(255,255,255,0.15)",
  slate900: "#0f172a",
  slate700: "#334155",
  slate600: "#475569",
  slate500: "#64748b",
  slate400: "#94a3b8",
  slate300: "#cbd5e1",
  slate200: "#e2e8f0",
  slate100: "#f1f5f9",
  slate50: "#f8fafc",
  violet50: "#f5f3ff",
  violet200: "#ddd6fe",
  violet700: "#6d28d9",
};


/** Rows past this are cut, with a note. Keeps rendering time sane. */
const MAX_PDF_ROWS = 1200;
/** Columns past this don't fit on a landscape A4 legibly. */
const MAX_PDF_COLS = 12;

const styles = StyleSheet.create({
  page: { fontFamily: PDF_FONT, fontSize: 9, color: C.slate700 },
  band: {
    backgroundColor: C.primary,
    color: C.white,
    paddingVertical: 20,
    paddingHorizontal: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  bandLeft: { flexDirection: "row", alignItems: "center" },
  logoBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: C.whiteBox,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  eyebrow: {
    fontSize: 7,
    letterSpacing: 2,
    color: C.whiteSoft,
    fontFamily: PDF_FONT,
    fontWeight: 700,
  },
  churchName: {
    fontSize: 17,
    fontFamily: PDF_FONT,
    fontWeight: 700,
    marginTop: 2,
  },
  bandRight: { alignItems: "flex-end" },
  periodText: { fontSize: 10, fontFamily: PDF_FONT, fontWeight: 700 },
  bandSub: { fontSize: 8, color: C.whiteSoft, marginTop: 2 },

  body: { paddingHorizontal: 28, paddingTop: 16, paddingBottom: 44 },
  lead: { fontSize: 9, color: C.slate600, marginBottom: 10, lineHeight: 1.4 },
  empty: { marginTop: 40, textAlign: "center", color: C.slate500 },

  tileRow: { flexDirection: "row", marginBottom: 8 },
  tile: {
    flexGrow: 1,
    flexBasis: 0,
    marginHorizontal: 3,
    borderWidth: 1,
    borderColor: C.slate200,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  tileAccent: { borderColor: C.violet200, backgroundColor: C.violet50 },
  tileValue: {
    fontSize: 15,
    fontFamily: PDF_FONT,
    fontWeight: 700,
    color: C.slate900,
  },
  tileValueAccent: { color: C.violet700 },
  tileLabel: {
    fontSize: 6.5,
    letterSpacing: 0.5,
    color: C.slate500,
    fontFamily: PDF_FONT,
    fontWeight: 700,
    marginTop: 2,
    textTransform: "uppercase",
  },

  sectionTitle: {
    fontSize: 8,
    letterSpacing: 0.6,
    color: C.slate500,
    fontFamily: PDF_FONT,
    fontWeight: 700,
    textTransform: "uppercase",
    marginTop: 14,
    marginBottom: 6,
  },
  table: { borderWidth: 1, borderColor: C.slate200, borderRadius: 6 },
  thead: {
    flexDirection: "row",
    backgroundColor: C.slate100,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  th: {
    fontSize: 6.5,
    fontFamily: PDF_FONT,
    fontWeight: 700,
    color: C.slate600,
    textTransform: "uppercase",
  },
  trEven: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderTopColor: C.slate100,
    backgroundColor: C.white,
  },
  trOdd: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderTopColor: C.slate100,
    backgroundColor: C.slate50,
  },
  td: { fontSize: 7, color: C.slate600 },
  numCell: { color: C.slate400, textAlign: "right", paddingRight: 6 },
  cell: { flexGrow: 1, flexBasis: 0, paddingRight: 4 },
  // Was italic. The embedded family ships regular and bold only, and
  // react-pdf THROWS on an unresolvable style rather than falling back, so a
  // stray italic would turn a download into a 500. Colour carries the aside.
  note: {
    marginTop: 8,
    fontSize: 7.5,
    color: C.slate500,
  },
  dictRow: {
    borderTopWidth: 1,
    borderTopColor: C.slate100,
    paddingVertical: 6,
  },
  dictName: {
    fontSize: 9,
    fontFamily: PDF_FONT,
    fontWeight: 700,
    color: C.slate900,
  },
  dictMeta: { fontSize: 7.5, color: C.slate500, marginTop: 1 },
  dictJoin: { fontSize: 7.5, color: C.violet700, marginTop: 1 },

  footer: {
    position: "absolute",
    bottom: 16,
    left: 28,
    right: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: C.slate200,
    paddingTop: 6,
  },
  footerText: { fontSize: 7, color: C.slate500 },
});

// The header and footer now come from lib/pdf-chrome, so every module's PDF
// is the same document and the branding rule lives in one place.

function Tile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <View style={accent ? [styles.tile, styles.tileAccent] : styles.tile}>
      <Text style={accent ? [styles.tileValue, styles.tileValueAccent] : styles.tileValue}>
        {String(value)}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

/** One dataset as a landscape table. */
export async function renderDatasetPdf(args: {
  brand: ChurchBrand;
  dataset: Dataset;
  data: DatasetResult;
  range: { from: string | null; to: string | null };
}): Promise<Buffer> {
  const { brand, dataset, data, range } = args;
  const churchName = brand.name;
  const generated = format(new Date(), "MMM d, yyyy 'at' h:mm a");

  // Ids are dropped from the PDF and kept in the CSV. See isIdColumn.
  const readableCount = data.columns.filter((c) => !isIdColumn(c)).length;
  const trimmedCols = readableCount > MAX_PDF_COLS;
  const colIdx = pdfColumns(data.columns, MAX_PDF_COLS);
  const droppedIds = data.columns.length - readableCount;

  const rows = data.rows.slice(0, MAX_PDF_ROWS);
  const trimmedRows = data.rows.length > rows.length;
  const weights = columnWeights(data.columns, rows, colIdx);
  // The row number replaces the id: it gives someone reading aloud in a
  // meeting something to point at, without a line of hex.
  const NUM_WEIGHT = Math.max(3, String(rows.length).length + 1.5);

  const doc = (
    <Document title={`${churchName} — ${dataset.label}`} author={churchName}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <BrandBand
          brand={brand}
          label={dataset.label}
          right={rangeLabel(range)}
          rightSub={`${data.rows.length.toLocaleString()} ${
            data.rows.length === 1 ? "row" : "rows"
          }`}
        />
        <View style={styles.body}>
          <Text style={styles.lead}>
            {dataset.description} {dataset.grain}.
          </Text>

          {rows.length === 0 ? (
            <Text style={styles.empty}>Nothing recorded for this period.</Text>
          ) : (
            <View style={styles.table}>
              <View style={styles.thead} fixed>
                <View style={[styles.cell, { flexGrow: NUM_WEIGHT }]}>
                  <Text style={[styles.th, styles.numCell]}>#</Text>
                </View>
                {colIdx.map((i, n) => (
                  <View key={i} style={[styles.cell, { flexGrow: weights[n] }]}>
                    <Text style={styles.th}>{humanize(data.columns[i])}</Text>
                  </View>
                ))}
              </View>
              {rows.map((row, r) => (
                <View key={r} style={r % 2 ? styles.trOdd : styles.trEven} wrap={false}>
                  <View style={[styles.cell, { flexGrow: NUM_WEIGHT }]}>
                    <Text style={[styles.td, styles.numCell]}>{r + 1}</Text>
                  </View>
                  {colIdx.map((i, n) => (
                    <View key={i} style={[styles.cell, { flexGrow: weights[n] }]}>
                      <Text style={styles.td}>{short(row[i], cellLimit(weights[n]))}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}

          {(trimmedRows || trimmedCols || droppedIds > 0) && (
            <Text style={styles.note}>
              {trimmedRows
                ? `Showing the first ${rows.length.toLocaleString()} of ${data.rows.length.toLocaleString()} rows. `
                : ""}
              {trimmedCols
                ? `Showing ${MAX_PDF_COLS} of ${readableCount} columns. `
                : ""}
              {droppedIds > 0
                ? "Reference ids are left out of the PDF for readability. "
                : ""}
              Download the CSV for the complete data, ids included.
            </Text>
          )}
        </View>
        <BrandFooter brand={brand} generated={generated} />
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}


/* -------------------------------------------------------------------------
 * The summary report
 *
 * Rewritten after a church asked why their report was "queries and technical
 * jargon instead of real data". It was a fair description: the page carried
 * four headline tiles and then three pages of data dictionary — table names,
 * row counts, "one row per member per session", and join keys written as
 * `household_id -> households.household_id`. That is a note from one
 * programme to another, printed on a document a pastor hands to a board.
 *
 * What replaces it is the church's own figures: where the giving came from,
 * who turned up and to what, how each month moved, who is on the register,
 * which groups are biggest, what the messages cost. The dictionary is gone.
 * What survives of it is one plain list at the back answering the only
 * question it was ever good for — which modules have anything in them.
 * ---------------------------------------------------------------------- */

const sum = StyleSheet.create({
  /** A plain two-line intro under a section heading. */
  caption: { fontSize: 7.5, color: C.slate500, marginBottom: 5, lineHeight: 1.35 },

  tableHead: {
    flexDirection: "row",
    backgroundColor: C.slate100,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: C.slate100,
  },
  rowAlt: { backgroundColor: C.slate50 },
  rowTotal: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: C.slate300,
    backgroundColor: C.violet50,
  },
  frame: { borderWidth: 1, borderColor: C.slate200, borderRadius: 6 },

  head: {
    fontSize: 6.5,
    fontFamily: PDF_FONT,
    fontWeight: 700,
    color: C.slate600,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  cellText: { fontSize: 8, color: C.slate700 },
  cellName: {
    fontSize: 8,
    color: C.slate900,
    fontFamily: PDF_FONT,
    fontWeight: 700,
  },
  cellStrong: {
    fontSize: 8,
    color: C.slate900,
    fontFamily: PDF_FONT,
    fontWeight: 700,
  },
  right: { textAlign: "right" },

  /** The "what came" line under the attendance table. */
  mix: {
    marginTop: 6,
    fontSize: 7.5,
    color: C.slate600,
    lineHeight: 1.45,
  },

  /** One module in the closing list. */
  holding: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    borderTopWidth: 1,
    borderTopColor: C.slate100,
  },
  holdingName: { fontSize: 8, color: C.slate700, flexGrow: 1, flexBasis: 0, paddingRight: 8 },
  holdingCount: {
    fontSize: 8,
    color: C.slate900,
    fontFamily: PDF_FONT,
    fontWeight: 700,
  },
  holdingEmpty: { fontSize: 8, color: C.slate400 },
  holdingGroup: {
    fontSize: 7,
    fontFamily: PDF_FONT,
    fontWeight: 700,
    color: C.slate500,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 9,
    marginBottom: 1,
  },

  note: {
    marginTop: 5,
    fontSize: 7,
    color: C.slate500,
    lineHeight: 1.4,
  },

  nothing: {
    borderWidth: 1,
    borderColor: C.slate200,
    borderRadius: 6,
    padding: 12,
    fontSize: 8,
    color: C.slate500,
    lineHeight: 1.45,
  },
});

/** A column: what to print, how wide, and whether it reads right-to-left. */
type Column<T> = {
  head: string;
  width: number;
  align?: "right";
  /** Bold, for the name column and for a figure the eye should land on. */
  strong?: boolean;
  value: (row: T) => string;
};

/**
 * One table. Deliberately dumb — no sorting, no totals of its own — because
 * every caller already has its rows in the order it wants them and a total it
 * can state more precisely than a generic sum could.
 */
function Table<T>({
  columns,
  rows,
  total,
}: {
  columns: Column<T>[];
  rows: T[];
  /** An optional closing row, already formatted, cell for cell. */
  total?: string[];
}) {
  return (
    <View style={sum.frame}>
      <View style={sum.tableHead}>
        {columns.map((c, i) => (
          <View key={i} style={[styles.cell, { flexGrow: c.width }]}>
            <Text style={c.align === "right" ? [sum.head, sum.right] : sum.head}>
              {c.head}
            </Text>
          </View>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} style={r % 2 ? [sum.row, sum.rowAlt] : sum.row} wrap={false}>
          {columns.map((c, i) => {
            const base = c.strong ? sum.cellStrong : sum.cellText;
            return (
              <View key={i} style={[styles.cell, { flexGrow: c.width }]}>
                <Text style={c.align === "right" ? [base, sum.right] : base}>
                  {c.value(row)}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
      {total && (
        <View style={sum.rowTotal} wrap={false}>
          {total.map((cell, i) => (
            <View key={i} style={[styles.cell, { flexGrow: columns[i]?.width ?? 1 }]}>
              <Text
                style={
                  columns[i]?.align === "right"
                    ? [sum.cellStrong, sum.right]
                    : sum.cellStrong
                }
              >
                {cell}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** A heading, an optional line of explanation, and whatever follows. */
function Section({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      {caption && <Text style={sum.caption}>{caption}</Text>}
      {children}
    </View>
  );
}

/**
 * The line under a table that was cut short.
 *
 * Ten rows with nothing said about an eleventh reads as the whole truth. A
 * church with fourteen giving categories would see four disappear and have no
 * way to tell that from four nobody ever recorded — the same "one rendered
 * state meaning two different things" that this report was full of.
 */
function Omitted({ count, noun }: { count: number; noun: string }) {
  if (count <= 0) return null;
  // "category" pluralises to "categories", not "categorys". The only four
  // nouns this is called with are category, service, month and group.
  const plural = noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`;
  return (
    <Text style={sum.note}>
      {count === 1
        ? `One more ${noun} is not shown here.`
        : `${count.toLocaleString()} more ${plural} are not shown here.`}{" "}
      The spreadsheet on the reports page has all of them.
    </Text>
  );
}

const whole = (n: number) => Math.round(n).toLocaleString();

/**
 * The report a church actually reads: its own numbers, in its own words.
 *
 * The CSVs beside it are still the artefact for analysis — this one is for the
 * people in the room.
 */
export async function renderSummaryPdf(args: {
  brand: ChurchBrand;
  totals: ChurchTotals;
  insights: SummaryInsights;
  datasets: Dataset[];
  counts: Record<string, number>;
  range: ReportRange;
  money: (n: number) => string;
}): Promise<Buffer> {
  const { brand, totals, insights, datasets, counts, range, money } = args;
  const churchName = brand.name;
  const generated = format(new Date(), "MMM d, yyyy 'at' h:mm a");
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  const ranged = !!(range.from || range.to);
  const period = ranged ? rangeLabel(range) : "all time";

  const byCategory = CATEGORIES.map((cat) => ({
    ...cat,
    items: datasets.filter((d) => d.category === cat.key),
  })).filter((c) => c.items.length > 0);

  const { attendanceMix: mixed } = insights;
  /*
   * Only name the age bands the church actually records. Youths and seniors
   * are off by default and a church that has never turned them on should not
   * read "0 youths" and wonder what it did wrong; a church that HAS turned
   * them on and genuinely counted none should still see the zero, which is
   * why this tests the recorded figure rather than a settings flag.
   */
  const mixParts = [
    mixed.adults > 0 ? `${whole(mixed.adults)} adults` : null,
    mixed.youths > 0 ? `${whole(mixed.youths)} youths` : null,
    mixed.teens > 0 ? `${whole(mixed.teens)} teenagers` : null,
    mixed.children > 0 ? `${whole(mixed.children)} children` : null,
    mixed.seniors > 0 ? `${whole(mixed.seniors)} senior members` : null,
  ].filter(Boolean) as string[];

  const doc = (
    <Document title={`${churchName} — Data report`} author={churchName}>
      <Page size="A4" style={styles.page}>
        <BrandBand
          brand={brand}
          label="Data report"
          right={rangeLabel(range)}
          rightSub={`${totalRows.toLocaleString()} records in all`}
        />
        <View style={styles.body}>
          <Text style={styles.lead}>
            What {churchName} recorded, {ranged ? `between ${period}` : "since it started"}.
            Every figure here is counted from your own records. The spreadsheets
            in the reports centre hold the same information row by row, for
            anyone who wants to work with it in Excel.
          </Text>

          {/*
            Two rows, and the split is the point. The first counts things that
            ARE and is never filtered; the second counts things that HAPPENED
            and follows the date range. Mixing them under one heading is how
            this page previously showed all-time figures beneath a date range
            in the header.
          */}
          <Text style={styles.sectionTitle}>The church today</Text>
          <View style={styles.tileRow}>
            <Tile label="Members" value={totals.members.toLocaleString()} accent />
            <Tile label="Households" value={totals.households.toLocaleString()} />
            <Tile label="Groups" value={totals.groups.toLocaleString()} />
            <Tile label="Recorded since" value={totals.firstDate ?? "—"} />
          </View>

          <Text style={styles.sectionTitle}>
            {ranged ? `Activity · ${period}` : "Activity · all time"}
          </Text>
          <View style={styles.tileRow}>
            <Tile label="Services recorded" value={totals.sessions.toLocaleString()} />
            <Tile label="Average attendance" value={totals.avgAttendance.toLocaleString()} />
            <Tile label="Total giving" value={money(totals.givingTotal)} accent />
            <Tile label="Messages sent" value={totals.messages.toLocaleString()} />
          </View>

          {insights.empty && (
            <Text style={sum.nothing}>
              There is nothing recorded for this period yet. Once services,
              giving and members are entered, this report fills itself in — and
              a wider date range, or no range at all, will usually show the
              records that are already there.
            </Text>
          )}

          {insights.givingByCategory.length > 0 && (
            <Section
              title="Where the giving came from"
              caption={`Every gift recorded ${ranged ? `between ${period}` : "so far"}, grouped by what it was given for.`}
            >
              <Table
                columns={[
                  {
                    head: "Category",
                    width: 7,
                    strong: true,
                    value: (r: GivingByCategory) => r.name,
                  },
                  {
                    head: "Gifts",
                    width: 3,
                    align: "right",
                    value: (r) => r.entries.toLocaleString(),
                  },
                  {
                    head: "Total",
                    width: 5,
                    align: "right",
                    strong: true,
                    value: (r) => money(r.total),
                  },
                  {
                    head: "Share",
                    width: 3,
                    align: "right",
                    value: (r) => `${r.share.toFixed(1)}%`,
                  },
                ]}
                rows={insights.givingByCategory}
                total={[
                  "All giving",
                  totals.givingEntries.toLocaleString(),
                  money(totals.givingTotal),
                  "100%",
                ]}
              />
              <Omitted count={insights.omitted.givingCategories} noun="category" />
            </Section>
          )}

          {insights.attendanceByService.length > 0 && (
            <Section
              title="Who turned up"
              caption="Each service you recorded a headcount for, how many times it met, and what it averaged."
            >
              <Table
                columns={[
                  {
                    head: "Service",
                    width: 8,
                    strong: true,
                    value: (r: AttendanceByService) => r.name,
                  },
                  {
                    head: "Times recorded",
                    width: 4,
                    align: "right",
                    value: (r) => r.sessions.toLocaleString(),
                  },
                  {
                    head: "Average",
                    width: 3,
                    align: "right",
                    strong: true,
                    value: (r) => whole(r.average),
                  },
                  {
                    head: "Best",
                    width: 3,
                    align: "right",
                    value: (r) => whole(r.best),
                  },
                ]}
                rows={insights.attendanceByService}
              />
              <Omitted count={insights.omitted.services} noun="service" />
              {(mixParts.length > 0 || mixed.firstTimers > 0 || mixed.newConverts > 0) && (
                <Text style={sum.mix}>
                  {mixParts.length > 0 && `Counted across every headcount: ${mixParts.join(", ")}.`}
                  {mixed.firstTimers > 0 &&
                    ` ${whole(mixed.firstTimers)} ${mixed.firstTimers === 1 ? "person came" : "people came"} for the first time.`}
                  {mixed.newConverts > 0 &&
                    ` ${whole(mixed.newConverts)} new ${mixed.newConverts === 1 ? "convert was" : "converts were"} recorded.`}
                </Text>
              )}
            </Section>
          )}

          {insights.months.length > 0 && (
            <Section
              title="Month by month"
              caption="The same figures again, split by month, so a run of quiet weeks is visible rather than averaged away."
            >
              <Table
                columns={[
                  {
                    head: "Month",
                    width: 4,
                    strong: true,
                    value: (r: MonthRow) => monthLabel(r.month),
                  },
                  {
                    head: "Services",
                    width: 3,
                    align: "right",
                    value: (r) => r.services.toLocaleString(),
                  },
                  {
                    head: "Average attendance",
                    width: 4,
                    align: "right",
                    value: (r) => (r.services > 0 ? whole(r.average) : "—"),
                  },
                  {
                    head: "New members",
                    width: 3,
                    align: "right",
                    value: (r) => (r.newMembers > 0 ? r.newMembers.toLocaleString() : "—"),
                  },
                  {
                    head: "Giving",
                    width: 5,
                    align: "right",
                    strong: true,
                    value: (r) => (r.giving > 0 ? money(r.giving) : "—"),
                  },
                ]}
                rows={insights.months}
              />
              <Omitted count={insights.omitted.months} noun="month" />
            </Section>
          )}

          {insights.statuses.length > 0 && (
            <Section
              title="The register today"
              caption="Not filtered by date: this is who is on the roll now, however long ago they joined."
            >
              <Table
                columns={[
                  {
                    head: "Standing",
                    width: 8,
                    strong: true,
                    value: (r: StatusCount) => STATUS_LABEL[r.status] ?? r.status,
                  },
                  {
                    head: "People",
                    width: 3,
                    align: "right",
                    strong: true,
                    value: (r) => r.members.toLocaleString(),
                  },
                  {
                    head: "Share of the roll",
                    width: 4,
                    align: "right",
                    value: (r) =>
                      totals.members > 0
                        ? `${((r.members / totals.members) * 100).toFixed(1)}%`
                        : "—",
                  },
                ]}
                rows={insights.statuses}
              />
            </Section>
          )}

          {insights.groups.length > 0 && (
            <Section
              title="Groups and ministries"
              caption="Your largest groups by membership, as they stand today. A group with nobody in it still appears — that is usually the point."
            >
              <Table
                columns={[
                  {
                    head: "Group",
                    width: 9,
                    strong: true,
                    value: (r: GroupSize) => r.name,
                  },
                  {
                    head: "Members",
                    width: 3,
                    align: "right",
                    strong: true,
                    value: (r) => (r.members > 0 ? r.members.toLocaleString() : "none yet"),
                  },
                ]}
                rows={insights.groups}
              />
              <Omitted count={insights.omitted.groups} noun="group" />
            </Section>
          )}

          {insights.channels.length > 0 && (
            <Section
              title="Messages"
              caption={`What you sent ${ranged ? `between ${period}` : "so far"}, and what reached a person. "Not delivered" counts both the sends that failed and the people who had no number or address on file.`}
            >
              <Table
                columns={[
                  {
                    head: "How",
                    width: 4,
                    strong: true,
                    value: (r: ChannelRow) => CHANNEL_LABEL[r.channel] ?? r.channel,
                  },
                  {
                    head: "Sends",
                    width: 3,
                    align: "right",
                    value: (r) => r.sends.toLocaleString(),
                  },
                  {
                    head: "People reached",
                    width: 4,
                    align: "right",
                    strong: true,
                    value: (r) => r.reached.toLocaleString(),
                  },
                  {
                    head: "Not delivered",
                    width: 4,
                    align: "right",
                    value: (r) => (r.failed + r.skipped).toLocaleString(),
                  },
                  {
                    head: "Cost",
                    width: 4,
                    align: "right",
                    value: (r) => (r.cost > 0 ? money(r.cost) : "—"),
                  },
                ]}
                rows={insights.channels}
              />
            </Section>
          )}

          {/*
            What is left of the old data dictionary.
            It answered one question worth answering — "has this module got
            anything in it at all?" — so that question survives, in words,
            with the row counts and without the foreign keys. The counts are
            all-time on purpose: whether a module is empty should not change
            as someone adjusts the date pickers.
          */}
          <Section
            title="What else is in your records"
            caption="Everything the platform is holding for you, counted for all time rather than for this period. Each line can be downloaded as a spreadsheet from the reports page."
          >
            {byCategory.map((cat) => (
              <View key={cat.key} wrap={false}>
                <Text style={sum.holdingGroup}>{cat.label}</Text>
                {cat.items.map((d) => {
                  const n = counts[d.id] ?? 0;
                  return (
                    <View key={d.id} style={sum.holding}>
                      <Text style={sum.holdingName}>{d.label}</Text>
                      <Text style={n > 0 ? sum.holdingCount : sum.holdingEmpty}>
                        {n > 0 ? n.toLocaleString() : "nothing recorded"}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ))}
          </Section>
        </View>
        <BrandFooter brand={brand} generated={generated} />
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
