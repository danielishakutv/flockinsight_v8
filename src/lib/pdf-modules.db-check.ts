/**
 * Every module's PDF must actually render. Run with `pnpm test:db`.
 *
 * They all now share one branded header and footer, so a mistake in that
 * chrome breaks every download at once — and a PDF that throws only surfaces
 * when someone clicks the button.
 */
import { describe, expect, it } from "vitest";
import type { ChurchBrand } from "@/lib/pdf-brand";
import { renderAttendancePdf } from "@/lib/attendance-pdf";
import { renderMembersPdf } from "@/lib/members-pdf";
import { renderDatasetPdf, renderSummaryPdf } from "@/lib/report-pdf";
import { getDataset } from "@/lib/report-catalog";
import type { SummaryInsights } from "@/lib/report-summary";
import { formatMoney } from "@/lib/money";
import { renderGivingPdf } from "@/lib/giving-pdf";

const brand: ChurchBrand = {
  name: "Grace Chapel International",
  logo: null,
  primary: "#059669",
  from: "#10b981",
  to: "#0d9488",
  contact: "12 Church Road, Ikeja, Lagos  ·  0801 234 5678  ·  hi@grace.org",
  referralUrl: "https://flockinsight.com/r/grace-chapel",
};

/** A church with nothing filled in — no logo, no contact details. */
const bare: ChurchBrand = { ...brand, logo: null, contact: null };

/**
 * A church with something in every section of the data report.
 *
 * Written out in full rather than cast from a partial: a fixture missing a
 * field once made a passing test out of a document that would have thrown in
 * production.
 */
const insights: SummaryInsights = {
  givingByCategory: [
    { name: "Tithe", entries: 180, total: 2_900_000, share: 60.2 },
    { name: "Offering", entries: 95, total: 1_420_000, share: 29.5 },
    { name: "Uncategorised", entries: 35, total: 500_000, share: 10.3 },
  ],
  attendanceByService: [
    { name: "Sunday Service", sessions: 13, average: 182, best: 241 },
    { name: "Midweek Service", sessions: 12, average: 64, best: 88 },
    { name: "Watchnight", sessions: 1, average: 310, best: 310 },
  ],
  attendanceMix: {
    adults: 1840,
    teens: 320,
    youths: 0,
    seniors: 0,
    children: 610,
    firstTimers: 48,
    newConverts: 12,
  },
  months: [
    { month: "2026-01", services: 9, average: 170, newMembers: 11, giving: 1_500_000 },
    { month: "2026-02", services: 8, average: 158, newMembers: 4, giving: 1_320_000 },
    // A month with attendance but no giving, and none joining: the shape that
    // the merge in report-summary has to survive.
    { month: "2026-03", services: 9, average: 191, newMembers: 0, giving: 0 },
  ],
  groups: [
    { name: "Choir", members: 42 },
    { name: "Ushers", members: 18 },
    // An empty group is deliberately kept — it renders as "none yet".
    { name: "Media Team", members: 0 },
  ],
  statuses: [
    { status: "active", members: 198 },
    { status: "visitor", members: 28 },
    { status: "new_convert", members: 9 },
    { status: "inactive", members: 5 },
  ],
  channels: [
    { channel: "sms", sends: 40, recipients: 900, reached: 870, failed: 12, skipped: 18, cost: 28_500 },
    { channel: "email", sends: 22, recipients: 410, reached: 404, failed: 6, skipped: 0, cost: 0 },
    { channel: "notification", sends: 60, recipients: 1400, reached: 1400, failed: 0, skipped: 0, cost: 0 },
  ],
  // Two categories and one group past the cut, so the report has to say so
  // rather than quietly presenting ten rows as the whole picture.
  omitted: { givingCategories: 2, services: 0, groups: 1, months: 0 },
  empty: false,
};

/** The same report for a church that has recorded nothing yet. */
const noInsights: SummaryInsights = {
  givingByCategory: [],
  attendanceByService: [],
  attendanceMix: {
    adults: 0,
    teens: 0,
    youths: 0,
    seniors: 0,
    children: 0,
    firstTimers: 0,
    newConverts: 0,
  },
  months: [],
  groups: [],
  statuses: [],
  channels: [],
  omitted: { givingCategories: 0, services: 0, groups: 0, months: 0 },
  empty: true,
};

const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === "%PDF-";
const range = { from: "2026-01-01", to: "2026-03-31" };

describe("attendance report", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    serviceName: "Sunday Service",
    men: 40 + i,
    women: 55 + i,
    youth: 20,
    children: 30,
    visitors: 5,
    total: 150 + i,
    note: null,
  }));
  const summary = {
    sessions: 12,
    total: 1800,
    average: 150,
    best: 162,
    men: 500,
    women: 660,
    youth: 240,
    children: 360,
    visitors: 60,
  };

  it("renders", async () => {
    const pdf = await renderAttendancePdf({
      brand,
      rows: rows as never,
      summary: summary as never,
    });
    expect(isPdf(pdf)).toBe(true);
  });

  it("renders for a church with nothing filled in, and no rows", async () => {
    const pdf = await renderAttendancePdf({
      brand: bare,
      rows: [] as never,
      summary: { ...summary, sessions: 0, total: 0, average: 0, best: 0 } as never,
    });
    expect(isPdf(pdf)).toBe(true);
  });
});

describe("member directory", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    name: `Member ${i}`,
    phone: "0801 234 5678",
    email: `member${i}@example.com`,
    gender: i % 2 ? "Male" : "Female",
    status: "Active",
    joinedAt: "2025-06-01",
  }));

  it("renders", async () => {
    const pdf = await renderMembersPdf({ brand, rows: rows as never });
    expect(isPdf(pdf)).toBe(true);
  });

  it("renders an empty directory", async () => {
    const pdf = await renderMembersPdf({ brand: bare, rows: [] as never });
    expect(isPdf(pdf)).toBe(true);
  });
});

describe("report centre", () => {
  const dataset = getDataset("members")!;
  const data = {
    columns: ["member_id", "first_name", "last_name", "phone"],
    rows: Array.from({ length: 40 }, (_, i) => [
      `id-${i}`,
      `First${i}`,
      `Last${i}`,
      "0801 234 5678",
    ]),
  };

  it("renders a dataset", async () => {
    const pdf = await renderDatasetPdf({ brand, dataset, data, range });
    expect(isPdf(pdf)).toBe(true);
  });

  it("renders a dataset with no rows", async () => {
    const pdf = await renderDatasetPdf({
      brand: bare,
      dataset,
      data: { columns: data.columns, rows: [] },
      range,
    });
    expect(isPdf(pdf)).toBe(true);
  });

  it("renders the summary", async () => {
    const pdf = await renderSummaryPdf({
      brand,
      // The real shape, not a cast — a partial fixture hid a missing field
      // and made a passing test out of a document that would have thrown.
      totals: {
        members: 240,
        households: 96,
        groups: 8,
        sessions: 52,
        avgAttendance: 150,
        givingTotal: 4820000,
        givingEntries: 310,
        messages: 1240,
        currency: "NGN",
        firstDate: "2025-01-05",
        lastDate: "2026-03-29",
      },
      insights,
      datasets: [dataset],
      counts: { members: 240 },
      range,
      // The real formatter, so the Naira sign goes through the embedded font
      // rather than being dodged by a test that writes "NGN" instead. This is
      // the character that rendered as a broken bar for months.
      money: (n: number) => formatMoney(n, "NGN"),
    });
    expect(isPdf(pdf)).toBe(true);

    /*
     * The Naira bug, nailed down.
     *
     * Helvetica is WinAnsi-encoded and has no ₦, so every money figure in
     * every PDF the platform made read `¦3,659,040.00` — a broken bar — with
     * nothing thrown and nothing logged. Asserting the embedded font is in
     * the file, and that no Helvetica is left anywhere in it, catches a
     * revert far earlier than a church reading its own giving report does.
     */
    const raw = pdf.toString("latin1");
    expect(raw).toContain("NotoSans");
    expect(raw).not.toContain("Helvetica");
  });

  it("renders the summary for a church with nothing recorded yet", async () => {
    const pdf = await renderSummaryPdf({
      brand: bare,
      totals: {
        members: 0,
        households: 0,
        groups: 0,
        sessions: 0,
        avgAttendance: 0,
        givingTotal: 0,
        givingEntries: 0,
        messages: 0,
        currency: "NGN",
        firstDate: null,
        lastDate: null,
      },
      insights: noInsights,
      datasets: [dataset],
      counts: { members: 0 },
      range: { from: null, to: null },
      money: (n: number) => formatMoney(n, "NGN"),
    });
    expect(isPdf(pdf)).toBe(true);
  });
});

describe("giving statement", () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({
    id: `g${i}`,
    date: `2026-02-${String((i % 28) + 1).padStart(2, "0")}`,
    amount: [50000, 12000, 250000, 7500.5][i % 4],
    categoryName: ["Offering", "Tithe", "Building Project"][i % 3],
    giver: i % 5 === 0 ? null : `Member ${i}`,
    method: "transfer",
    projectName: i % 3 === 2 ? "New auditorium" : null,
    note: null,
  }));

  it("renders", async () => {
    const pdf = await renderGivingPdf({
      brand,
      currency: "NGN",
      rows,
      totalRows: 15,
      total: 1_642_507.5,
      byCategory: [
        { name: "Offering", total: 900000 },
        { name: "Tithe", total: 500000 },
        { name: "Building Project", total: 242507.5 },
      ],
      rangeLabel: "1 – 28 Feb 2026",
    });
    expect(isPdf(pdf)).toBe(true);
  });

  it("renders for a church with nothing given yet", async () => {
    const pdf = await renderGivingPdf({
      brand: bare,
      currency: "NGN",
      rows: [],
      totalRows: 0,
      total: 0,
      byCategory: [],
      rangeLabel: "All time",
    });
    expect(isPdf(pdf)).toBe(true);
  });

  it("caps a very long statement", async () => {
    const many = Array.from({ length: 1400 }, (_, i) => ({ ...rows[0], id: `x${i}` }));
    const pdf = await renderGivingPdf({
      brand,
      currency: "NGN",
      rows: many,
      totalRows: 3000,
      total: 90_000_000,
      byCategory: [{ name: "Offering", total: 90_000_000 }],
      rangeLabel: "All time",
    });
    expect(isPdf(pdf)).toBe(true);
  }, 60000);
});
