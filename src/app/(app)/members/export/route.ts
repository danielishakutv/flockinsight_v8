import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import {
  MEMBER_CSV_HEADERS,
  MEMBER_CSV_SAMPLE,
  getMemberExportRows,
} from "@/lib/members-data";
import { CSV_BOM, toCsv } from "@/lib/csv";

// GET /members/export            → all members as CSV
// GET /members/export?template=1 → header row + one example row (import guide)
export async function GET(request: Request) {
  const { church } = await requireChurch();
  const isTemplate =
    new URL(request.url).searchParams.get("template") === "1";
  /*
   * A route handler is its own entry point: no page guard or layout runs before
   * it, so the permission is checked here. 403, not a redirect — a redirect
   * inside a download saves the sign-in page as a .csv. The template carries
   * only the sample row, so it needs no permission.
   */
  if (!isTemplate && !(await can("members.view"))) {
    return new Response("You don't have permission to export members.", {
      status: 403,
    });
  }

  const header = [...MEMBER_CSV_HEADERS];
  const body = isTemplate
    ? [MEMBER_CSV_SAMPLE]
    : await getMemberExportRows(church.id);

  const csv = CSV_BOM + toCsv([header, ...body]);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = isTemplate
    ? "members-import-template.csv"
    : `${church.slug}-members-${stamp}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
