import { requireChurch } from "@/lib/session";
import { getAttendanceRows } from "@/lib/attendance-export";
import {
  ATTENDANCE_CSV_HEADERS,
  ATTENDANCE_CSV_SAMPLE,
} from "@/lib/attendance-data";

/** Quote a CSV cell only when it contains a comma, quote, or newline. */
function csvCell(value: string | number | null): string {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /attendance/export            → all recorded attendance as CSV
// GET /attendance/export?template=1 → header row + one example row
export async function GET(request: Request) {
  const { church } = await requireChurch();
  const isTemplate = new URL(request.url).searchParams.get("template") === "1";

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

  const lines = [header, ...body];

  const out = lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
  // Leading BOM (U+FEFF) so Excel opens UTF-8 correctly; CRLF line endings.
  const BOM = String.fromCharCode(0xfeff);
  const csv = BOM + out;

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
