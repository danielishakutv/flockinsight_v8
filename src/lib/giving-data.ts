import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { giving, givingCategory, member } from "@/db/schema";
import { normalizeHeader } from "@/lib/members-data";

/** CSV column order for export and the template. */
export const GIVING_CSV_HEADERS = [
  "Date",
  "Category",
  "Amount",
  "Giver",
  "Method",
  "Note",
] as const;

/** One illustrative row shown in the downloadable template. */
export const GIVING_CSV_SAMPLE: string[] = [
  "2026-01-04",
  "Tithe",
  "5000",
  "John Doe",
  "cash",
  "",
];

export type GivingFieldKey =
  | "date"
  | "category"
  | "amount"
  | "giver"
  | "method"
  | "note";

const HEADER_ALIASES: Record<string, GivingFieldKey> = {
  date: "date",
  day: "date",
  category: "category",
  type: "category",
  fund: "category",
  givingtype: "category",
  amount: "amount",
  value: "amount",
  sum: "amount",
  total: "amount",
  giver: "giver",
  name: "giver",
  member: "giver",
  donor: "giver",
  givername: "giver",
  method: "method",
  paymentmethod: "method",
  mode: "method",
  channel: "method",
  note: "note",
  notes: "note",
  reference: "note",
  description: "note",
};

export function headerToGivingField(header: string): GivingFieldKey | null {
  return HEADER_ALIASES[normalizeHeader(header)] ?? null;
}

const METHODS = [
  "cash",
  "transfer",
  "card",
  "cheque",
  "online",
  "other",
] as const;
export type GivingMethod = (typeof METHODS)[number];

export function normalizeMethod(v: string | undefined): GivingMethod | null {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if ((METHODS as readonly string[]).includes(s)) return s as GivingMethod;
  if (s === "bank" || s === "transfer" || s === "banktransfer") return "transfer";
  if (s === "pos" || s === "card" || s === "debitcard") return "card";
  if (s === "check") return "cheque";
  if (s === "web" || s === "online" || s === "paystack") return "online";
  return "other";
}

/** Parse a money amount: strips currency symbols, commas and spaces. */
export function normalizeAmount(v: string | undefined): number | null {
  const cleaned = String(v ?? "").replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** All giving for a church as CSV rows (matching GIVING_CSV_HEADERS). */
export async function getGivingExportRows(
  churchId: string,
): Promise<(string | number | null)[][]> {
  const rows = await db
    .select({
      date: giving.date,
      categoryName: givingCategory.name,
      amount: giving.amount,
      method: giving.method,
      note: giving.note,
      giverName: giving.giverName,
      memberFirst: member.firstName,
      memberLast: member.lastName,
    })
    .from(giving)
    .leftJoin(givingCategory, eq(givingCategory.id, giving.categoryId))
    .leftJoin(member, eq(member.id, giving.memberId))
    .where(eq(giving.churchId, churchId))
    .orderBy(desc(giving.date), desc(giving.createdAt));

  return rows.map((r) => [
    r.date,
    r.categoryName ?? "",
    r.amount,
    [r.memberFirst, r.memberLast].filter(Boolean).join(" ") ||
      r.giverName ||
      "",
    r.method ?? "",
    r.note ?? "",
  ]);
}

/** Active + inactive categories for a church (for import name-matching). */
export async function getGivingCategories(churchId: string) {
  return db
    .select({ id: givingCategory.id, name: givingCategory.name })
    .from(givingCategory)
    .where(eq(givingCategory.churchId, churchId))
    .orderBy(asc(givingCategory.sortOrder), asc(givingCategory.name));
}
