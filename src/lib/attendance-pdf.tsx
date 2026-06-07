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
import { format, parseISO } from "date-fns";
import type {
  AttendanceExportRow,
  AttendanceSummary,
} from "@/lib/attendance-export";

// Brand palette (kept in sync with the on-screen report).
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

// lucide "church" glyph, drawn white inside the header monogram.
const CHURCH_PATHS = [
  "M10 9h4",
  "M12 7v5",
  "M14 21v-3a2 2 0 0 0-4 0v3",
  "m18 9 3.52 2.147a1 1 0 0 1 .48.854V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6.999a1 1 0 0 1 .48-.854L6 9",
  "M6 21V7a1 1 0 0 1 .376-.782l5-3.999a1 1 0 0 1 1.249.001l5 4A1 1 0 0 1 18 7v14",
];

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: C.slate700 },

  band: {
    backgroundColor: C.primary,
    color: C.white,
    paddingVertical: 24,
    paddingHorizontal: 32,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  bandLeft: { flexDirection: "row", alignItems: "center" },
  logoBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: C.whiteBox,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  eyebrow: {
    fontSize: 7.5,
    letterSpacing: 2,
    color: C.whiteSoft,
    fontFamily: "Helvetica-Bold",
  },
  churchName: { fontSize: 19, fontFamily: "Helvetica-Bold", marginTop: 2 },
  bandRight: { alignItems: "flex-end" },
  periodText: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  bandSub: { fontSize: 8.5, color: C.whiteSoft, marginTop: 2 },

  body: { paddingHorizontal: 32, paddingTop: 20, paddingBottom: 48 },
  empty: { marginTop: 40, textAlign: "center", color: C.slate500 },

  tileRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
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
  tileValue: { fontSize: 16, fontFamily: "Helvetica-Bold", color: C.slate900 },
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
  table: { borderWidth: 1, borderColor: C.slate200, borderRadius: 8 },
  thead: {
    flexDirection: "row",
    backgroundColor: C.slate100,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  th: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: C.slate600, textTransform: "uppercase" },
  trEven: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: C.slate100,
    backgroundColor: C.white,
  },
  trOdd: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: C.slate100,
    backgroundColor: C.slate50,
  },
  td: { fontSize: 8.5, color: C.slate600 },
  tdName: { fontSize: 8.5, color: C.slate900, fontFamily: "Helvetica-Bold" },
  tdNum: { fontSize: 8.5, color: C.slate700, textAlign: "right" },
  tdTotal: { fontSize: 8.5, color: C.slate900, fontFamily: "Helvetica-Bold", textAlign: "right" },
  tfoot: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderTopWidth: 2,
    borderTopColor: C.slate300,
    backgroundColor: C.slate100,
  },
  tfootCell: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.slate900 },

  colDate: { flexGrow: 2.4, flexBasis: 0 },
  colName: { flexGrow: 3.6, flexBasis: 0 },
  colNum: { flexGrow: 1, flexBasis: 0, textAlign: "right" },

  footer: {
    position: "absolute",
    bottom: 18,
    left: 32,
    right: 32,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: C.slate200,
    paddingTop: 6,
  },
  footerText: { fontSize: 7, color: C.slate500 },
});

function fmt(d: string) {
  return format(parseISO(d), "MMM d, yyyy");
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

export async function renderAttendancePdf(args: {
  churchName: string;
  rows: AttendanceExportRow[];
  summary: AttendanceSummary;
}): Promise<Buffer> {
  const { churchName, rows, summary: s } = args;

  const period =
    s.firstDate && s.lastDate
      ? s.firstDate === s.lastDate
        ? fmt(s.lastDate)
        : `${fmt(s.firstDate)} - ${fmt(s.lastDate)}`
      : "No records yet";
  const generated = format(new Date(), "MMM d, yyyy 'at' h:mm a");

  const doc = (
    <Document title={`${churchName} - Attendance Report`} author={churchName}>
      <Page size="A4" style={styles.page}>
        {/* Church-forward header band */}
        <View style={styles.band}>
          <View style={styles.bandLeft}>
            <View style={styles.logoBox}>
              <Svg width={20} height={20} viewBox="0 0 24 24">
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
              <Text style={styles.eyebrow}>ATTENDANCE REPORT</Text>
              <Text style={styles.churchName}>{churchName}</Text>
            </View>
          </View>
          <View style={styles.bandRight}>
            <Text style={styles.periodText}>{period}</Text>
            <Text style={styles.bandSub}>
              {s.sessions} {s.sessions === 1 ? "service" : "services"} recorded
            </Text>
          </View>
        </View>

        <View style={styles.body}>
          {rows.length === 0 ? (
            <Text style={styles.empty}>No attendance has been recorded yet.</Text>
          ) : (
            <>
              <View style={styles.tileRow}>
                <Tile label="Total attendance" value={s.total} accent />
                <Tile label="Avg / service" value={s.average} />
                <Tile label="Peak service" value={s.peak} />
                <Tile label="Services" value={s.sessions} />
              </View>
              <View style={styles.tileRow}>
                <Tile label="Men" value={s.male} />
                <Tile label="Women" value={s.female} />
                <Tile label="Children" value={s.children} />
                <Tile label="First-timers" value={s.firstTimers} />
                <Tile label="New converts" value={s.newConverts} />
              </View>

              <Text style={styles.sectionTitle}>Service-by-service</Text>
              <View style={styles.table}>
                <View style={styles.thead}>
                  <Text style={[styles.th, styles.colDate]}>Date</Text>
                  <Text style={[styles.th, styles.colName]}>Service / Event</Text>
                  <Text style={[styles.th, styles.colNum]}>Men</Text>
                  <Text style={[styles.th, styles.colNum]}>Women</Text>
                  <Text style={[styles.th, styles.colNum]}>Children</Text>
                  <Text style={[styles.th, styles.colNum]}>First</Text>
                  <Text style={[styles.th, styles.colNum]}>New</Text>
                  <Text style={[styles.th, styles.colNum]}>Total</Text>
                </View>
                {rows.map((r, i) => (
                  <View
                    key={`${r.date}-${i}`}
                    style={i % 2 === 0 ? styles.trEven : styles.trOdd}
                    wrap={false}
                  >
                    <Text style={[styles.td, styles.colDate]}>{fmt(r.date)}</Text>
                    <Text style={[styles.tdName, styles.colName]}>{r.name}</Text>
                    <Text style={[styles.tdNum, styles.colNum]}>{r.male}</Text>
                    <Text style={[styles.tdNum, styles.colNum]}>{r.female}</Text>
                    <Text style={[styles.tdNum, styles.colNum]}>{r.children}</Text>
                    <Text style={[styles.tdNum, styles.colNum]}>{r.firstTimers}</Text>
                    <Text style={[styles.tdNum, styles.colNum]}>{r.newConverts}</Text>
                    <Text style={[styles.tdTotal, styles.colNum]}>{r.total}</Text>
                  </View>
                ))}
                <View style={styles.tfoot}>
                  <Text style={[styles.tfootCell, styles.colDate]}>Total</Text>
                  <Text style={[styles.tfootCell, styles.colName]}> </Text>
                  <Text style={[styles.tfootCell, styles.colNum]}>{s.male}</Text>
                  <Text style={[styles.tfootCell, styles.colNum]}>{s.female}</Text>
                  <Text style={[styles.tfootCell, styles.colNum]}>{s.children}</Text>
                  <Text style={[styles.tfootCell, styles.colNum]}>{s.firstTimers}</Text>
                  <Text style={[styles.tfootCell, styles.colNum]}>{s.newConverts}</Text>
                  <Text style={[styles.tfootCell, styles.colNum]}>{s.total}</Text>
                </View>
              </View>
            </>
          )}
        </View>

        {/* Subtle fixed footer — minimal platform branding */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {churchName} · Generated {generated}
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages} · FlockInsight`
            }
          />
        </View>
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
