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
import { renderGivingPdf } from "@/lib/giving-pdf";

const brand: ChurchBrand = {
  name: "Grace Chapel International",
  logo: null,
  primary: "#059669",
  from: "#10b981",
  to: "#0d9488",
  contact: "12 Church Road, Ikeja, Lagos  ·  0801 234 5678  ·  hi@grace.org",
};

/** A church with nothing filled in — no logo, no contact details. */
const bare: ChurchBrand = { ...brand, logo: null, contact: null };

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
      datasets: [dataset],
      counts: { members: 240 },
      range,
      money: (n: number) => `NGN ${n.toLocaleString()}`,
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
