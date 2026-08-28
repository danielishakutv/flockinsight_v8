import "server-only";
import {
  Document,
  Page,
  View,
  Text,
  Svg,
  Path,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { format } from "date-fns";
import type { DatasetResult } from "@/lib/report-data";
import type { ChurchTotals } from "@/lib/report-data";
import { CATEGORIES, type Dataset } from "@/lib/report-catalog";

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
  slate300: "#cbd5e1",
  slate200: "#e2e8f0",
  slate100: "#f1f5f9",
  slate50: "#f8fafc",
  violet50: "#f5f3ff",
  violet200: "#ddd6fe",
  violet700: "#6d28d9",
};

const CHURCH_PATHS = [
  "M10 9h4",
  "M12 7v5",
  "M14 21v-3a2 2 0 0 0-4 0v3",
  "m18 9 3.52 2.147a1 1 0 0 1 .48.854V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6.999a1 1 0 0 1 .48-.854L6 9",
  "M6 21V7a1 1 0 0 1 .376-.782l5-3.999a1 1 0 0 1 1.249.001l5 4A1 1 0 0 1 18 7v14",
];

/** Rows past this are cut, with a note. Keeps rendering time sane. */
const MAX_PDF_ROWS = 1200;
/** Columns past this don't fit on a landscape A4 legibly. */
const MAX_PDF_COLS = 12;

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: C.slate700 },
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
    fontFamily: "Helvetica-Bold",
  },
  churchName: { fontSize: 17, fontFamily: "Helvetica-Bold", marginTop: 2 },
  bandRight: { alignItems: "flex-end" },
  periodText: { fontSize: 10, fontFamily: "Helvetica-Bold" },
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
  tileValue: { fontSize: 15, fontFamily: "Helvetica-Bold", color: C.slate900 },
  tileValueAccent: { color: C.violet700 },
  tileLabel: {
    fontSize: 6.5,
    letterSpacing: 0.5,
    color: C.slate500,
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
    textTransform: "uppercase",
  },

  sectionTitle: {
    fontSize: 8,
    letterSpacing: 0.6,
    color: C.slate500,
    fontFamily: "Helvetica-Bold",
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
    fontFamily: "Helvetica-Bold",
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
  cell: { flexGrow: 1, flexBasis: 0, paddingRight: 4 },
  note: {
    marginTop: 8,
    fontSize: 7.5,
    color: C.slate500,
    fontStyle: "italic",
  },
  dictRow: {
    borderTopWidth: 1,
    borderTopColor: C.slate100,
    paddingVertical: 6,
  },
  dictName: { fontSize: 9, fontFamily: "Helvetica-Bold", color: C.slate900 },
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

function Band({
  eyebrow,
  churchName,
  right,
  rightSub,
}: {
  eyebrow: string;
  churchName: string;
  right: string;
  rightSub: string;
}) {
  return (
    <View style={styles.band}>
      <View style={styles.bandLeft}>
        <View style={styles.logoBox}>
          <Svg width={19} height={19} viewBox="0 0 24 24">
            {CHURCH_PATHS.map((d, i) => (
              <Path
                key={i}
                d={d}
                stroke={C.white}
                strokeWidth={2}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </Svg>
        </View>
        <View>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.churchName}>{churchName}</Text>
        </View>
      </View>
      <View style={styles.bandRight}>
        <Text style={styles.periodText}>{right}</Text>
        <Text style={styles.bandSub}>{rightSub}</Text>
      </View>
    </View>
  );
}

function Footer({ generated }: { generated: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>Generated {generated} · FlockInsight</Text>
      <Text
        style={styles.footerText}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}

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

/** Column header → something readable: `member_name` → `Member name`. */
function humanize(column: string): string {
  const s = column.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Keep a cell from blowing the column width apart. */
function short(v: string | number | null, limit = 42): string {
  const s = v == null ? "" : String(v);
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
}

function rangeLabel(range: { from: string | null; to: string | null }): string {
  if (range.from && range.to) return `${range.from} to ${range.to}`;
  if (range.from) return `From ${range.from}`;
  if (range.to) return `Up to ${range.to}`;
  return "All time";
}

/** One dataset as a landscape table. */
export async function renderDatasetPdf(args: {
  churchName: string;
  dataset: Dataset;
  data: DatasetResult;
  range: { from: string | null; to: string | null };
}): Promise<Buffer> {
  const { churchName, dataset, data, range } = args;
  const generated = format(new Date(), "MMM d, yyyy 'at' h:mm a");

  const trimmedCols = data.columns.length > MAX_PDF_COLS;
  const colIdx = data.columns
    .map((_, i) => i)
    .filter((i) => i < MAX_PDF_COLS);
  const rows = data.rows.slice(0, MAX_PDF_ROWS);
  const trimmedRows = data.rows.length > rows.length;

  const doc = (
    <Document title={`${churchName} — ${dataset.label}`} author={churchName}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Band
          eyebrow={dataset.label.toUpperCase()}
          churchName={churchName}
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
                {colIdx.map((i) => (
                  <View key={i} style={styles.cell}>
                    <Text style={styles.th}>{humanize(data.columns[i])}</Text>
                  </View>
                ))}
              </View>
              {rows.map((row, r) => (
                <View key={r} style={r % 2 ? styles.trOdd : styles.trEven} wrap={false}>
                  {colIdx.map((i) => (
                    <View key={i} style={styles.cell}>
                      <Text style={styles.td}>{short(row[i])}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}

          {(trimmedRows || trimmedCols) && (
            <Text style={styles.note}>
              {trimmedRows
                ? `Showing the first ${rows.length.toLocaleString()} of ${data.rows.length.toLocaleString()} rows. `
                : ""}
              {trimmedCols
                ? `Showing ${MAX_PDF_COLS} of ${data.columns.length} columns. `
                : ""}
              Download the CSV for the complete data.
            </Text>
          )}
        </View>
        <Footer generated={generated} />
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}

/**
 * The cover report: headline numbers, what each category holds, and the data
 * dictionary. This is the thing you hand to a board; the CSVs are the thing
 * you hand to whoever does the analysis.
 */
export async function renderSummaryPdf(args: {
  churchName: string;
  totals: ChurchTotals;
  datasets: Dataset[];
  counts: Record<string, number>;
  range: { from: string | null; to: string | null };
  money: (n: number) => string;
}): Promise<Buffer> {
  const { churchName, totals, datasets, counts, range, money } = args;
  const generated = format(new Date(), "MMM d, yyyy 'at' h:mm a");
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);

  const byCategory = CATEGORIES.map((cat) => ({
    ...cat,
    items: datasets.filter((d) => d.category === cat.key),
  })).filter((c) => c.items.length > 0);

  const doc = (
    <Document title={`${churchName} — Data report`} author={churchName}>
      <Page size="A4" style={styles.page}>
        <Band
          eyebrow="DATA REPORT"
          churchName={churchName}
          right={rangeLabel(range)}
          rightSub={`${totalRows.toLocaleString()} rows across ${datasets.length} datasets`}
        />
        <View style={styles.body}>
          <Text style={styles.lead}>
            Everything FlockInsight holds for {churchName}, grouped by subject. Each
            dataset below is downloadable as a spreadsheet; every row carries its own
            id and the keys that link it to the others, so the files can be joined
            back together for analysis.
          </Text>

          <Text style={styles.sectionTitle}>At a glance</Text>
          <View style={styles.tileRow}>
            <Tile label="Members" value={totals.members.toLocaleString()} accent />
            <Tile label="Households" value={totals.households.toLocaleString()} />
            <Tile label="Groups" value={totals.groups.toLocaleString()} />
            <Tile label="Services recorded" value={totals.sessions.toLocaleString()} />
          </View>
          <View style={styles.tileRow}>
            <Tile label="Average attendance" value={totals.avgAttendance.toLocaleString()} />
            <Tile label="Total giving" value={money(totals.givingTotal)} accent />
            <Tile label="Giving entries" value={totals.givingEntries.toLocaleString()} />
            <Tile label="Messages sent" value={totals.messages.toLocaleString()} />
          </View>

          {byCategory.map((cat) => (
            <View key={cat.key}>
              <Text style={styles.sectionTitle}>
                {cat.label} — {cat.description}
              </Text>
              {cat.items.map((d) => (
                <View key={d.id} style={styles.dictRow} wrap={false}>
                  <Text style={styles.dictName}>
                    {d.label} · {(counts[d.id] ?? 0).toLocaleString()}{" "}
                    {(counts[d.id] ?? 0) === 1 ? "row" : "rows"}
                  </Text>
                  <Text style={styles.dictMeta}>
                    {d.grain}. {d.description}
                  </Text>
                  {d.joins && d.joins.length > 0 && (
                    <Text style={styles.dictJoin}>
                      Joins: {d.joins.map((j) => `${j.column} → ${j.target}`).join("   ·   ")}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          ))}
        </View>
        <Footer generated={generated} />
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
