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
import { KIND_LABEL, METHOD_LABEL } from "@/lib/finance-shared";
import type {
  FinanceAccountRow,
  FinanceSummary,
  FinanceTransactionRow,
} from "@/lib/finance-data";

/**
 * The finance statement: what came in, what went out, and what each account
 * holds. Meant to be printed and handed to a board or an auditor, so it leads
 * with the totals and the accounts, then lists the entries behind them.
 */

/** Past this the document stops being something anyone reads; the CSV is complete. */
const MAX_ROWS = 900;

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

  cards: { flexDirection: "row", gap: 8 },
  card: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.slate200,
    borderRadius: 6,
    padding: 10,
  },
  cardLabel: {
    fontSize: 7,
    letterSpacing: 1,
    color: C.slate500,
    fontFamily: "Helvetica-Bold",
  },
  cardValue: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 4 },
  cardHint: { fontSize: 6.5, color: C.slate500, marginTop: 2 },

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

/** Column widths, as percentages, for the ledger table. */
const LEDGER_COLS = [
  { key: "date", label: "DATE", width: "11%" },
  { key: "details", label: "DETAILS", width: "27%" },
  { key: "category", label: "CATEGORY", width: "17%" },
  { key: "account", label: "ACCOUNT", width: "17%" },
  { key: "method", label: "METHOD", width: "11%" },
  { key: "amount", label: "AMOUNT", width: "17%" },
];

export type FinancePdfArgs = {
  brand: ChurchBrand;
  currency: string;
  summary: FinanceSummary;
  accounts: FinanceAccountRow[];
  rows: FinanceTransactionRow[];
  /** Total matching rows, which may exceed what is printed. */
  totalRows: number;
  rangeLabel: string;
};

export async function renderFinancePdf(args: FinancePdfArgs): Promise<Buffer> {
  const { brand, currency, summary, accounts, rows, totalRows, rangeLabel } =
    args;
  const generated = format(new Date(), "d MMM yyyy 'at' HH:mm");
  const shown = rows.slice(0, MAX_ROWS);
  const open = accounts.filter((a) => a.isActive);

  const money = (n: number) => formatMoney(n, currency);

  return renderToBuffer(
    <Document title={`${brand.name} — Finance`} author={brand.name}>
      <Page size="A4" style={s.page}>
        <BrandBand
          brand={brand}
          label="Finance statement"
          right={rangeLabel}
          rightSub={`${totalRows} record${totalRows === 1 ? "" : "s"}`}
        />

        <View style={s.body}>
          {/* Headline figures */}
          <View style={s.cards}>
            <View style={s.card}>
              <Text style={s.cardLabel}>INCOME</Text>
              <Text style={[s.cardValue, { color: "#047857" }]}>
                {money(summary.income)}
              </Text>
              <Text style={s.cardHint}>in this period</Text>
            </View>
            <View style={s.card}>
              <Text style={s.cardLabel}>EXPENSES</Text>
              <Text style={[s.cardValue, { color: "#be123c" }]}>
                {money(summary.expense)}
              </Text>
              <Text style={s.cardHint}>in this period</Text>
            </View>
            <View style={s.card}>
              <Text style={s.cardLabel}>NET</Text>
              <Text
                style={[
                  s.cardValue,
                  { color: summary.net < 0 ? "#be123c" : C.slate900 },
                ]}
              >
                {money(summary.net)}
              </Text>
              <Text style={s.cardHint}>
                {summary.net < 0 ? "spent more than received" : "income less expenses"}
              </Text>
            </View>
            <View style={s.card}>
              <Text style={s.cardLabel}>CASH ON HAND</Text>
              <Text style={[s.cardValue, { color: C.slate900 }]}>
                {money(summary.cashOnHand)}
              </Text>
              <Text style={s.cardHint}>all open accounts, today</Text>
            </View>
          </View>

          {/* Accounts */}
          <Text style={s.sectionTitle}>Accounts</Text>
          {open.length === 0 ? (
            <Text style={s.empty}>No accounts have been set up yet.</Text>
          ) : (
            <View>
              <View style={[s.row, s.headRow]}>
                <Text style={[s.th, { width: "40%" }]}>ACCOUNT</Text>
                <Text style={[s.th, { width: "20%" }, s.right]}>IN</Text>
                <Text style={[s.th, { width: "20%" }, s.right]}>OUT</Text>
                <Text style={[s.th, { width: "20%" }, s.right]}>BALANCE</Text>
              </View>
              {open.map((a) => (
                <View key={a.id} style={[s.row, s.bodyRow]} wrap={false}>
                  <View style={{ width: "40%" }}>
                    <Text style={[s.td, s.bold]}>
                      {a.name}
                      {a.givingCategoryId ? "  (giving fund)" : ""}
                    </Text>
                  </View>
                  <Text style={[s.td, { width: "20%" }, s.right]}>
                    {money(a.income + a.transferredIn)}
                  </Text>
                  <Text style={[s.td, { width: "20%" }, s.right]}>
                    {money(a.expense + a.transferredOut)}
                  </Text>
                  <Text style={[s.td, { width: "20%" }, s.right, s.bold]}>
                    {money(a.balance)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Where the money went */}
          {summary.byCategory.length > 0 && (
            <>
              <Text style={s.sectionTitle}>By category</Text>
              <View>
                <View style={[s.row, s.headRow]}>
                  <Text style={[s.th, { width: "60%" }]}>CATEGORY</Text>
                  <Text style={[s.th, { width: "20%" }]}>TYPE</Text>
                  <Text style={[s.th, { width: "20%" }, s.right]}>TOTAL</Text>
                </View>
                {summary.byCategory.slice(0, 20).map((c, i) => (
                  <View key={`${c.kind}-${c.id ?? i}`} style={[s.row, s.bodyRow]} wrap={false}>
                    <Text style={[s.td, { width: "60%" }]}>{c.name}</Text>
                    <Text style={[s.td, { width: "20%" }, s.muted]}>
                      {KIND_LABEL[c.kind]}
                    </Text>
                    <Text style={[s.td, { width: "20%" }, s.right, s.bold]}>
                      {money(c.total)}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* The entries themselves */}
          <Text style={s.sectionTitle}>Entries</Text>
          {shown.length === 0 ? (
            <Text style={s.empty}>Nothing recorded in this period.</Text>
          ) : (
            <View>
              <View style={[s.row, s.headRow]} fixed>
                {LEDGER_COLS.map((col) => (
                  <Text
                    key={col.key}
                    style={[
                      s.th,
                      { width: col.width },
                      col.key === "amount" ? s.right : {},
                    ]}
                  >
                    {col.label}
                  </Text>
                ))}
              </View>
              {shown.map((r) => (
                <View key={r.id} style={[s.row, s.bodyRow]} wrap={false}>
                  <Text style={[s.td, { width: "11%" }]}>
                    {format(parseISO(r.date), "d MMM yy")}
                  </Text>
                  <Text style={[s.td, { width: "27%" }]}>
                    {r.party ?? KIND_LABEL[r.kind]}
                    {r.reference ? `  ·  ${r.reference}` : ""}
                  </Text>
                  <Text style={[s.td, { width: "17%" }, s.muted]}>
                    {r.categoryName ?? "—"}
                  </Text>
                  <Text style={[s.td, { width: "17%" }, s.muted]}>
                    {r.accountName ?? "—"}
                  </Text>
                  <Text style={[s.td, { width: "11%" }, s.muted]}>
                    {r.method ? (METHOD_LABEL[r.method] ?? r.method) : "—"}
                  </Text>
                  <Text
                    style={[
                      s.td,
                      { width: "17%" },
                      s.right,
                      s.bold,
                      { color: r.kind === "income" ? "#047857" : "#be123c" },
                    ]}
                  >
                    {r.kind === "income" ? "+" : "−"}
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
