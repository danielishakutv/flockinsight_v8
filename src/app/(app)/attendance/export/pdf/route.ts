import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getChurchBrand } from "@/lib/pdf-brand";
import {
  getAttendanceRows,
  summarizeAttendance,
} from "@/lib/attendance-export";
import { renderAttendancePdf } from "@/lib/attendance-pdf";

// GET /attendance/export/pdf → one-click themed PDF download (no print dialog).
export async function GET() {
  const { church } = await requireChurch();
  // A route handler is its own entry point; the /attendance page's guard does
  // not run for it. 403 rather than a redirect inside a download.
  if (!(await can("attendance.view"))) {
    return new Response("You don't have permission to export attendance.", {
      status: 403,
    });
  }
  const rows = await getAttendanceRows(church.id);
  const summary = summarizeAttendance(rows);

  const pdf = await renderAttendancePdf({
    brand: await getChurchBrand(church),
    rows,
    summary,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${church.slug}-attendance-${stamp}.pdf`;

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
