import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { CSV_BOM, toCsv } from "@/lib/csv";
import { getAttendanceRows } from "@/lib/attendance-export";
import {
  ATTENDANCE_CSV_HEADERS,
  ATTENDANCE_CSV_SAMPLE,
} from "@/lib/attendance-data";

// GET /attendance/export            → all recorded attendance as CSV
// GET /attendance/export?template=1 → header row + one example row
export async function GET(request: Request) {
  const { church } = await requireChurch();
  const isTemplate = new URL(request.url).searchParams.get("template") === "1";
  /*
   * A route handler is its own entry point: no page guard or layout runs before
   * it, so the permission is checked here. 403, not a redirect — a redirect
   * inside a download saves the sign-in page as a .csv. The template carries
   * only the sample row, so it needs no permission.
   */
  if (!isTemplate && !(await can("attendance.view"))) {
    return new Response("You don't have permission to export attendance.", {
      status: 403,
    });
  }

  const header = [...ATTENDANCE_CSV_HEADERS];
  const body = isTemplate
    ? [ATTENDANCE_CSV_SAMPLE]
    : (await getAttendanceRows(church.id)).map((r) => [
        r.date,
        r.name,
        r.total,
        r.male,
        r.female,
        r.teenMale,
        r.teenFemale,
        r.youthMale,
        r.youthFemale,
        r.seniorMale,
        r.seniorFemale,
        r.childMale,
        r.childFemale,
        r.children,
        r.firstTimerMale,
        r.firstTimerFemale,
        r.firstTimers,
        r.newConvertMale,
        r.newConvertFemale,
        r.newConverts,
        r.notes ?? "",
      ]);

  /*
   * Through the shared `toCsv`, like every other export. This route used to
   * quote cells itself and nothing more, so an event titled
   * `=HYPERLINK(...)` — anyone who can record attendance can name one — became
   * a live formula in the spreadsheet of whoever downloaded the file. `toCsv`
   * puts an apostrophe before it; the import takes it off again.
   * BOM so Excel opens UTF-8 correctly; CRLF line endings.
   */
  const csv = CSV_BOM + toCsv([header, ...body]);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = isTemplate
    ? "attendance-import-template.csv"
    : `${church.slug}-attendance-${stamp}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
