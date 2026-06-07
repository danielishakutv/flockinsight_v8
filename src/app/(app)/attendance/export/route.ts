import { requireChurch } from "@/lib/session";
import { getAttendanceRows } from "@/lib/attendance-export";

/** Quote a CSV cell only when it contains a comma, quote, or newline. */
function csvCell(value: string | number | null): string {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /attendance/export → downloads all recorded attendance as CSV.
export async function GET() {
  const { church } = await requireChurch();
  const rows = await getAttendanceRows(church.id);

  const header = [
    "Date",
    "Service / Event",
    "Total",
    "Male",
    "Female",
    "Children",
    "First-timers",
    "New converts",
    "Notes",
  ];
  const lines = [
    header,
    ...rows.map((r) => [
      r.date,
      r.name,
      r.total,
      r.male,
      r.female,
      r.children,
      r.firstTimers,
      r.newConverts,
      r.notes ?? "",
    ]),
  ];

  const body = lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
  // Leading BOM (U+FEFF) so Excel opens UTF-8 correctly; CRLF line endings.
  const BOM = String.fromCharCode(0xfeff);
  const csv = BOM + body;

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${church.slug}-attendance-${stamp}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
