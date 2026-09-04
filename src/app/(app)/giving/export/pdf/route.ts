import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { giving, givingCategory, member, project } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { parseGivingFilters } from "@/lib/giving-data";
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

  // The date range is the part of the filter a statement is really about, so
  // it is applied here directly rather than paging through getGivingList.
  const where = and(
    eq(giving.churchId, church.id),
    ...(f.from ? [sql`${giving.date} >= ${f.from}`] : []),
    ...(f.to ? [sql`${giving.date} <= ${f.to}`] : []),
    ...(f.categoryId && f.categoryId !== "none"
      ? [eq(giving.categoryId, f.categoryId)]
      : []),
  );

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
      .where(where)
      .groupBy(givingCategory.name),
    db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${giving.amount}), 0)`,
      })
      .from(giving)
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

  const rangeLabel =
    f.from && f.to
      ? `${f.from} to ${f.to}`
      : f.from
        ? `From ${f.from}`
        : f.to
          ? `Until ${f.to}`
          : "All time";

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
