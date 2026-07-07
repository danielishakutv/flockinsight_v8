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
};

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
  eyebrow: { fontSize: 7.5, letterSpacing: 2, color: C.whiteSoft, fontFamily: "Helvetica-Bold" },
  churchName: { fontSize: 19, fontFamily: "Helvetica-Bold", marginTop: 2 },
  bandRight: { alignItems: "flex-end" },
  periodText: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  bandSub: { fontSize: 8.5, color: C.whiteSoft, marginTop: 2 },
  body: { paddingHorizontal: 32, paddingTop: 20, paddingBottom: 48 },
  empty: { marginTop: 40, textAlign: "center", color: C.slate500 },
  table: { borderWidth: 1, borderColor: C.slate200, borderRadius: 8 },
  thead: { flexDirection: "row", backgroundColor: C.slate100, paddingVertical: 6, paddingHorizontal: 8 },
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
  colName: { flexGrow: 3, flexBasis: 0 },
  colGender: { flexGrow: 1.2, flexBasis: 0 },
  colStatus: { flexGrow: 1.6, flexBasis: 0 },
  colPhone: { flexGrow: 2.4, flexBasis: 0 },
  colEmail: { flexGrow: 3.4, flexBasis: 0 },
  colDob: { flexGrow: 2, flexBasis: 0 },
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

export type MemberPdfRow = {
  name: string;
  gender: string;
  status: string;
  phone: string;
  email: string;
  dob: string;
};

export async function renderMembersPdf(args: {
  churchName: string;
  rows: MemberPdfRow[];
}): Promise<Buffer> {
  const { churchName, rows } = args;
  const generated = format(new Date(), "MMM d, yyyy 'at' h:mm a");

  const doc = (
    <Document title={`${churchName} - Members`} author={churchName}>
      <Page size="A4" style={styles.page}>
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
              <Text style={styles.eyebrow}>MEMBER DIRECTORY</Text>
              <Text style={styles.churchName}>{churchName}</Text>
            </View>
          </View>
          <View style={styles.bandRight}>
            <Text style={styles.periodText}>
              {rows.length} {rows.length === 1 ? "member" : "members"}
            </Text>
            <Text style={styles.bandSub}>Generated {generated}</Text>
          </View>
        </View>

        <View style={styles.body}>
          {rows.length === 0 ? (
            <Text style={styles.empty}>No members to show.</Text>
          ) : (
            <View style={styles.table}>
              <View style={styles.thead}>
                <Text style={[styles.th, styles.colName]}>Name</Text>
                <Text style={[styles.th, styles.colGender]}>Gender</Text>
                <Text style={[styles.th, styles.colStatus]}>Status</Text>
                <Text style={[styles.th, styles.colPhone]}>Phone</Text>
                <Text style={[styles.th, styles.colEmail]}>Email</Text>
                <Text style={[styles.th, styles.colDob]}>Birthday</Text>
              </View>
              {rows.map((r, i) => (
                <View key={i} style={i % 2 === 0 ? styles.trEven : styles.trOdd} wrap={false}>
                  <Text style={[styles.tdName, styles.colName]}>{r.name || "—"}</Text>
                  <Text style={[styles.td, styles.colGender]}>{r.gender || "—"}</Text>
                  <Text style={[styles.td, styles.colStatus]}>{r.status || "—"}</Text>
                  <Text style={[styles.td, styles.colPhone]}>{r.phone || "—"}</Text>
                  <Text style={[styles.td, styles.colEmail]}>{r.email || "—"}</Text>
                  <Text style={[styles.td, styles.colDob]}>{r.dob || "—"}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{churchName}</Text>
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
