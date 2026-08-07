import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { giving, givingCategory, member, project } from "@/db/schema";
import { normalizeHeader } from "@/lib/members-data";

/** CSV column order for export and the template. */
export const GIVING_CSV_HEADERS = [
  "Date",
  "Category",
  "Amount",
  "Giver",
  "Method",
  "Note",
  "Project",
] as const;

/** One illustrative row shown in the downloadable template. */
export const GIVING_CSV_SAMPLE: string[] = [
  "2026-01-04",
  "Tithe",
  "5000",
  "John Doe",
  "cash",
  "",
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

/* ============================================================
 * Searching & filtering the giving ledger
 * The list is paged in the database rather than filtered in the browser:
 * a church accumulates thousands of gifts, and a search has to reach the
 * old ones, not just whichever page happens to be loaded.
 * ========================================================== */

/** Rows per page in the giving list. */
export const GIVING_PAGE_SIZE = 50;

/** Sentinel for "has no category / project at all" (vs. "any"). */
export const GIVING_FILTER_NONE = "none";

export type GivingFilters = {
  /** Free text: giver, note, category, project, or an exact amount. */
  q: string;
  /** Category id, `GIVING_FILTER_NONE`, or "" for any. */
  categoryId: string;
  /** Method enum value, or "" for any. */
  method: string;
  /** Project id, `GIVING_FILTER_NONE`, or "" for any. */
  projectId: string;
  /** Inclusive ISO date bounds, or "" for open-ended. */
  from: string;
  to: string;
  /** 1-based page number. */
  page: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

/** An id filter is only forwarded when it is a real uuid — a malformed value
 *  would otherwise blow up the uuid comparison in Postgres. */
function idParam(v: string | string[] | undefined): string {
  const s = one(v);
  if (s === GIVING_FILTER_NONE) return GIVING_FILTER_NONE;
  return UUID_RE.test(s) ? s : "";
}

function dateParam(v: string | string[] | undefined): string {
  const s = one(v);
  return ISO_DATE_RE.test(s) ? s : "";
}

/** Read the giving list filters out of a page's `searchParams`. */
export function parseGivingFilters(
  sp: Record<string, string | string[] | undefined>,
): GivingFilters {
  const method = one(sp.method).toLowerCase();
  const page = Number.parseInt(one(sp.page), 10);
  let from = dateParam(sp.from);
  let to = dateParam(sp.to);
  // Tolerate a back-to-front range instead of returning nothing.
  if (from && to && from > to) [from, to] = [to, from];

  return {
    q: one(sp.q).slice(0, 100),
    categoryId: idParam(sp.cat),
    method: (METHODS as readonly string[]).includes(method) ? method : "",
    projectId: idParam(sp.project),
    from,
    to,
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/** True when anything narrows the ledger (paging on its own doesn't count). */
export function hasGivingFilters(f: GivingFilters): boolean {
  return Boolean(
    f.q || f.categoryId || f.method || f.projectId || f.from || f.to,
  );
}

/** `%` and `_` are wildcards in LIKE — a giver searching "50%" means "50%". */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function givingWhere(churchId: string, f: GivingFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [eq(giving.churchId, churchId)];

  if (f.categoryId === GIVING_FILTER_NONE)
    conds.push(isNull(giving.categoryId));
  else if (f.categoryId) conds.push(eq(giving.categoryId, f.categoryId));

  if (f.projectId === GIVING_FILTER_NONE) conds.push(isNull(giving.projectId));
  else if (f.projectId) conds.push(eq(giving.projectId, f.projectId));

  if (f.method) conds.push(eq(giving.method, f.method as GivingMethod));
  if (f.from) conds.push(gte(giving.date, f.from));
  if (f.to) conds.push(lte(giving.date, f.to));

  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    const parts: (SQL | undefined)[] = [
      // Match across the giver's full name, so "john doe" works as typed.
      ilike(
        sql`concat_ws(' ', ${member.firstName}, ${member.lastName})`,
        like,
      ),
      ilike(giving.giverName, like),
      ilike(giving.note, like),
      ilike(givingCategory.name, like),
      ilike(project.name, like),
    ];
    // A bare number is almost always someone looking for an amount.
    const n = Number(f.q.replace(/[,\s]/g, ""));
    if (Number.isFinite(n) && n > 0) parts.push(eq(giving.amount, n));
    conds.push(or(...parts));
  }

  return and(...conds);
}

/** One page of the giving ledger, plus the count and sum of everything the
 *  filters match (not just the visible page). */
export async function getGivingList(churchId: string, f: GivingFilters) {
  const where = givingWhere(churchId, f);

  // Every join below is many-to-one, so the count and sum stay accurate.
  const [rows, [agg]] = await Promise.all([
    db
      .select({
        id: giving.id,
        amount: giving.amount,
        date: giving.date,
        method: giving.method,
        note: giving.note,
        categoryId: giving.categoryId,
        categoryName: givingCategory.name,
        memberId: giving.memberId,
        memberFirst: member.firstName,
        memberLast: member.lastName,
        giverName: giving.giverName,
        projectId: giving.projectId,
        projectName: project.name,
      })
      .from(giving)
      .leftJoin(givingCategory, eq(givingCategory.id, giving.categoryId))
      .leftJoin(member, eq(member.id, giving.memberId))
      .leftJoin(project, eq(project.id, giving.projectId))
      .where(where)
      .orderBy(desc(giving.date), desc(giving.createdAt))
      .limit(GIVING_PAGE_SIZE)
      .offset((f.page - 1) * GIVING_PAGE_SIZE),
    db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${giving.amount}), 0)`,
      })
      .from(giving)
      .leftJoin(givingCategory, eq(givingCategory.id, giving.categoryId))
      .leftJoin(member, eq(member.id, giving.memberId))
      .leftJoin(project, eq(project.id, giving.projectId))
      .where(where),
  ]);

  return {
    rows,
    count: Number(agg?.count ?? 0),
    total: Number(agg?.total ?? 0),
  };
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
      projectName: project.name,
    })
    .from(giving)
    .leftJoin(givingCategory, eq(givingCategory.id, giving.categoryId))
    .leftJoin(member, eq(member.id, giving.memberId))
    .leftJoin(project, eq(project.id, giving.projectId))
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
    r.projectName ?? "",
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
