import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { giving, givingCategory, member, project } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import {
  GIVING_FILTER_NONE,
  givingWhereFor,
  parseGivingFilters,
} from "@/lib/giving-data";
import { getChurchBrand } from "@/lib/pdf-brand";
import { renderGivingPdf, type GivingPdfRow } from "@/lib/giving-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How many entries the statement will print before pointing at the CSV. */
const MAX = 1000;

// GET /giving/export/pdf → the giving statement, honouring the page's filters.
export async function GET(request: Request) {
  const { church } = await requireChurch();
  // A route handler is its own entry point, so the permission is re-checked
  // here rather than assumed from having reached the link.
  if (!(await can("giving.view"))) {
    return new Response("Not allowed", { status: 403 });
  }

  const url = new URL(request.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  const f = parseGivingFilters(params);

  // The list's own WHERE clause — every filter, not just the dates. This
  // used to apply only from/to/category, and the menu link carried no query
  // string at all, so a "Building project, January" statement printed the
  // church's all-time giving. givingWhereFor reads member, category and
  // project names, so every query below joins all three; each join is
  // many-to-one, so counts and sums are unchanged by them.
  const where = givingWhereFor(church.id, f);

  // Name the narrowing filters on the statement, beside the dates.
  const [catRow, projRow] = await Promise.all([
    f.categoryId && f.categoryId !== GIVING_FILTER_NONE
      ? db
          .select({ name: givingCategory.name })
          .from(givingCategory)
          .where(and(eq(givingCategory.id, f.categoryId), eq(givingCategory.churchId, church.id)))
          .limit(1)
          .then((r) => r[0] ?? null)
      : null,
    f.projectId && f.projectId !== GIVING_FILTER_NONE
      ? db
          .select({ name: project.name })
          .from(project)
          .where(and(eq(project.id, f.projectId), eq(project.churchId, church.id)))
          .limit(1)
          .then((r) => r[0] ?? null)
      : null,
  ]);

  const [brand, rows, byCategory, [agg]] = await Promise.all([
    getChurchBrand(church),
    db
      .select({
        id: giving.id,
        date: giving.date,
        amount: giving.amount,
        method: giving.method,
        note: giving.note,
        categoryName: givingCategory.name,
        memberFirst: member.firstName,
        memberLast: member.lastName,
        giverName: giving.giverName,
        projectName: project.name,
      })
      .from(giving)
      .leftJoin(givingCategory, eq(givingCategory.id, giving.categoryId))
      .leftJoin(member, eq(member.id, giving.memberId))
      .leftJoin(project, eq(project.id, giving.projectId))
      .where(where)
      .orderBy(desc(giving.date), desc(giving.createdAt))
      .limit(MAX),
    db
      .select({
        name: givingCategory.name,
        total: sql<number>`coalesce(sum(${giving.amount}), 0)`,
      })
      .from(giving)
      .leftJoin(givingCategory, eq(givingCategory.id, giving.categoryId))
      .leftJoin(member, eq(member.id, giving.memberId))
      .leftJoin(project, eq(project.id, giving.projectId))
      .where(where)
      .groupBy(givingCategory.name),
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

  const pdfRows: GivingPdfRow[] = rows.map((r) => ({
    id: r.id,
    date: r.date,
    amount: Number(r.amount ?? 0),
    categoryName: r.categoryName,
    giver:
      [r.memberFirst, r.memberLast].filter(Boolean).join(" ").trim() ||
      r.giverName,
    method: r.method,
    projectName: r.projectName,
    note: r.note,
  }));

  const dates =
    f.from && f.to
      ? `${f.from} to ${f.to}`
      : f.from
        ? `From ${f.from}`
        : f.to
          ? `Until ${f.to}`
          : "All time";
  const narrowing: string[] = [];
  if (f.categoryId === GIVING_FILTER_NONE) narrowing.push("No category");
  else if (f.categoryId) narrowing.push(catRow?.name ?? "A removed category");
  if (f.projectId === GIVING_FILTER_NONE) narrowing.push("No project");
  else if (f.projectId) narrowing.push(projRow?.name ?? "A removed project");
  if (f.method) narrowing.push(f.method);
  if (f.q) narrowing.push(`"${f.q.slice(0, 40)}"`);
  const rangeLabel = [dates, ...narrowing].join(" · ");

  const pdf = await renderGivingPdf({
    brand,
    currency: church.currency,
    rows: pdfRows,
    totalRows: Number(agg?.count ?? 0),
    total: Number(agg?.total ?? 0),
    byCategory: byCategory
      .map((c) => ({
        name: c.name ?? "Uncategorised",
        total: Number(c.total ?? 0),
      }))
      .sort((a, b) => b.total - a.total),
    rangeLabel,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${church.slug}-giving-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
