import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { getOutstandingPledges, cadenceLabel } from "@/lib/projects";
import { CSV_BOM, toCsv } from "@/lib/csv";

const HEADERS = [
  "Giver",
  "Project",
  "Pledged",
  "Paid",
  "Outstanding",
  "How they give",
  "Status",
] as const;

// GET /giving/projects/report/export?project=&all=1 → outstanding pledges as CSV
export async function GET(request: Request) {
  const { church } = await requireChurch();
  await requireCan("giving.view");

  const sp = new URL(request.url).searchParams;
  const report = await getOutstandingPledges(church.id, {
    projectId: sp.get("project") || undefined,
    includeSettled: sp.get("all") === "1",
  });

  const rows = report.rows.map((r) => [
    r.name,
    r.projectName,
    r.amount,
    r.paid,
    r.outstanding,
    cadenceLabel(r.cadence, r.cadenceLabel),
    r.status,
  ]);

  const csv = CSV_BOM + toCsv([[...HEADERS], ...rows]);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${church.slug}-outstanding-pledges-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
