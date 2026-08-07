import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import {
  RECIPIENT_CSV_HEADERS,
  getMessage,
  getRecipientExportRows,
} from "@/lib/comm-message";
import { parseMessageFilters } from "@/lib/comm-message-shared";
import { CSV_BOM, toCsv } from "@/lib/csv";

// GET /communication/history/<id>/export?status=&q=
//   → who this message reached, as CSV (respecting the on-screen filters)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { church } = await requireChurch();
  await requireCan("communication.view");

  const { id } = await params;
  // Scope-check through the church before reading any recipient rows.
  const message = await getMessage(church.id, id);
  if (!message) return new Response("Not found", { status: 404 });

  const filters = parseMessageFilters(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const rows = await getRecipientExportRows(id, filters);

  const csv = CSV_BOM + toCsv([[...RECIPIENT_CSV_HEADERS], ...rows]);
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${church.slug}-message-recipients-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
