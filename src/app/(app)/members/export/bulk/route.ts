import { requireChurch } from "@/lib/session";
import { getChurchBrand } from "@/lib/pdf-brand";
import { requireCan } from "@/lib/permissions";
import { MEMBER_CSV_HEADERS, getMemberExportRows } from "@/lib/members-data";
import { formatBirthday } from "@/lib/birthday";
import { CSV_BOM, toCsv } from "@/lib/csv";
import { renderMembersPdf, type MemberPdfRow } from "@/lib/members-pdf";

/**
 * POST /members/export/bulk — export selected (or all) members as CSV or PDF.
 * Body: { ids?: string[]; format: "csv" | "pdf" }. Used by the members bulk bar
 * (fetch → blob → download), so any selection size works (unlike a GET link).
 */
export async function POST(request: Request) {
  const { church } = await requireChurch();
  await requireCan("members.view");

  let ids: string[] | undefined;
  let format: "csv" | "pdf" = "csv";
  try {
    const body = (await request.json()) as { ids?: unknown; format?: unknown };
    if (Array.isArray(body.ids))
      ids = body.ids.filter((v): v is string => typeof v === "string").slice(0, 5000);
    if (body.format === "pdf") format = "pdf";
  } catch {
    /* defaults */
  }

  const rows = await getMemberExportRows(church.id, ids);
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "pdf") {
    const pdfRows: MemberPdfRow[] = rows.map((r) => ({
      name: [r[0], r[1], r[2]].filter(Boolean).join(" "),
      gender: r[3] ?? "",
      status: (r[4] ?? "").replace(/_/g, " "),
      phone: r[5] ?? "",
      email: r[6] ?? "",
      dob: formatBirthday(r[7]),
    }));
    const pdf = await renderMembersPdf({ brand: await getChurchBrand(church), rows: pdfRows });
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${church.slug}-members-${stamp}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const csv = CSV_BOM + toCsv([[...MEMBER_CSV_HEADERS], ...rows]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${church.slug}-members-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
