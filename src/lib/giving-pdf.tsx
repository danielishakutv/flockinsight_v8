import "server-only";
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { format, parseISO } from "date-fns";
import { BrandBand, BrandFooter, PDF_COLORS as C } from "@/lib/pdf-chrome";
import type { ChurchBrand } from "@/lib/pdf-brand";
import { formatMoney } from "@/lib/money";

/**
 * The giving statement: who gave, toward what, and how much came in.
 *
 * Distinct from the finance statement, which answers what the church holds.
 * This one is about the giving itself, and is the document a church prints for
 * a board meeting or files at year end.
 */

/** Past this nobody reads it; the CSV is the complete record. */
const MAX_ROWS = 900;

export type GivingPdfRow = {
  id: string;
  date: string;
  amount: number;
  categoryName: string | null;
  giver: string | null;
  method: string | null;
  projectName: string | null;
  note: string | null;
};

export type GivingPdfArgs = {
  brand: ChurchBrand;
  currency: string;
  rows: GivingPdfRow[];
  /** Every match, which may exceed what is printed. */
  totalRows: number;
  total: number;
  byCategory: { name: string; total: number }[];
  rangeLabel: string;
};

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: C.slate700,
    paddingBottom: 46,
  },
  body: { paddingHorizontal: 28, paddingTop: 18 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: C.slate900,
    marginBottom: 8,
    marginTop: 14,
  },
  headline: {
    borderWidth: 1,
    borderColor: C.slate200,
    borderRadius: 6,
    padding: 12,
    marginBottom: 4,
  },
  headlineLabel: {
    fontSize: 7,
    letterSpacing: 1,
    color: C.slate500,
    fontFamily: "Helvetica-Bold",
  },
  headlineValue: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: C.slate900,
    marginTop: 4,
  },
  headlineHint: { fontSize: 7, color: C.slate500, marginTop: 2 },

  row: { flexDirection: "row" },
  th: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: C.slate600,
    letterSpacing: 0.6,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  td: { fontSize: 8, paddingVertical: 5, paddingHorizontal: 4 },
  headRow: {
    borderBottomWidth: 1,
    borderBottomColor: C.slate300,
    backgroundColor: C.slate50,
  },
  bodyRow: { borderBottomWidth: 0.5, borderBottomColor: C.slate200 },
  totalRow: { borderTopWidth: 1, borderTopColor: C.slate300 },
  right: { textAlign: "right" },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: C.slate500 },
  note: { fontSize: 7.5, color: C.slate500, marginTop: 10 },
  empty: {
    fontSize: 9,
    color: C.slate500,
    textAlign: "center",
    paddingVertical: 24,
  },
});

export async function renderGivingPdf(args: GivingPdfArgs): Promise<Buffer> {
  const { brand, currency, rows, totalRows, total, byCategory, rangeLabel } =
    args;
  const generated = format(new Date(), "d MMM yyyy 'at' HH:mm");
  const shown = rows.slice(0, MAX_ROWS);
  const money = (n: number) => formatMoney(n, currency);

  return renderToBuffer(
    <Document title={`${brand.name} — Giving`} author={brand.name}>
      <Page size="A4" style={s.page}>
        <BrandBand
          brand={brand}
          label="Giving statement"
          right={rangeLabel}
          rightSub={`${totalRows} ${totalRows === 1 ? "entry" : "entries"}`}
        />

        <View style={s.body}>
          <View style={s.headline}>
            <Text style={s.headlineLabel}>TOTAL RECEIVED</Text>
            <Text style={s.headlineValue}>{money(total)}</Text>
            <Text style={s.headlineHint}>
              across {totalRows} {totalRows === 1 ? "entry" : "entries"} in this
              period
            </Text>
          </View>

          {byCategory.length > 0 && (
            <>
              <Text style={s.sectionTitle}>By category</Text>
              <View>
                <View style={[s.row, s.headRow]}>
                  <Text style={[s.th, { width: "70%" }]}>CATEGORY</Text>
                  <Text style={[s.th, { width: "30%" }, s.right]}>TOTAL</Text>
                </View>
                {byCategory.map((c) => (
                  <View key={c.name} style={[s.row, s.bodyRow]} wrap={false}>
                    <Text style={[s.td, { width: "70%" }]}>{c.name}</Text>
                    <Text style={[s.td, { width: "30%" }, s.right, s.bold]}>
                      {money(c.total)}
                    </Text>
                  </View>
                ))}
                <View style={[s.row, s.totalRow]}>
                  <Text style={[s.td, { width: "70%" }, s.bold]}>Total</Text>
                  <Text style={[s.td, { width: "30%" }, s.right, s.bold]}>
                    {money(total)}
                  </Text>
                </View>
              </View>
            </>
          )}

          <Text style={s.sectionTitle}>Entries</Text>
          {shown.length === 0 ? (
            <Text style={s.empty}>No giving recorded in this period.</Text>
          ) : (
            <View>
              <View style={[s.row, s.headRow]} fixed>
                <Text style={[s.th, { width: "12%" }]}>DATE</Text>
                <Text style={[s.th, { width: "28%" }]}>GIVER</Text>
                <Text style={[s.th, { width: "22%" }]}>CATEGORY</Text>
                <Text style={[s.th, { width: "20%" }]}>PROJECT</Text>
                <Text style={[s.th, { width: "18%" }, s.right]}>AMOUNT</Text>
              </View>
              {shown.map((r) => (
                <View key={r.id} style={[s.row, s.bodyRow]} wrap={false}>
                  <Text style={[s.td, { width: "12%" }]}>
                    {format(parseISO(r.date), "d MMM yy")}
                  </Text>
                  <Text style={[s.td, { width: "28%" }]}>
                    {r.giver ?? "Anonymous"}
                  </Text>
                  <Text style={[s.td, { width: "22%" }, s.muted]}>
                    {r.categoryName ?? "Uncategorised"}
                  </Text>
                  <Text style={[s.td, { width: "20%" }, s.muted]}>
                    {r.projectName ?? "—"}
                  </Text>
                  <Text style={[s.td, { width: "18%" }, s.right, s.bold]}>
                    {money(r.amount)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {totalRows > shown.length && (
            <Text style={s.note}>
              Showing the first {shown.length} of {totalRows} entries. Download
              the CSV for the complete record.
            </Text>
          )}
        </View>

        <BrandFooter brand={brand} generated={generated} />
      </Page>
    </Document>,
  );
}
