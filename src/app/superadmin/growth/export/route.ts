import { desc } from "drizzle-orm";
import { db } from "@/db";
import { lead } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { toCsv, CSV_BOM } from "@/lib/csv";
import { LEAD_CSV_TEMPLATE_HEADERS } from "@/lib/growth-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

// GET /superadmin/growth/export -> the pipeline as a CSV download.
// The columns match what the importer accepts, so an exported file can be
// edited in a spreadsheet and brought straight back in.
export async function GET() {
  await requireSuperAdmin();

  const rows = await db.select().from(lead).orderBy(desc(lead.createdAt));

  const csv = toCsv([
    [...LEAD_CSV_TEMPLATE_HEADERS, "Status", "Next follow-up", "Last contacted", "Added"],
    ...rows.map((r) => [
      r.churchName,
      r.contactName ?? "",
      r.role ?? "",
      r.email ?? "",
      r.phone ?? "",
      r.whatsapp ?? "",
      r.city ?? "",
      r.state ?? "",
      r.denomination ?? "",
      r.size ?? "",
      r.source,
      r.notes ?? "",
      r.status,
      iso(r.nextFollowUpAt),
      iso(r.lastContactedAt),
      iso(r.createdAt),
    ]),
  ]);

  const date = new Date().toISOString().slice(0, 10);
  return new Response(CSV_BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="flockinsight-leads-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
