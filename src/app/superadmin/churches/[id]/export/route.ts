import { requireSuperAdmin } from "@/lib/session";
import { exportChurch } from "@/lib/church-data";
import { slugify } from "@/lib/slug";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /superadmin/churches/[id]/export -> full church backup as a JSON download.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireSuperAdmin();
  const { id } = await params;

  const data = await exportChurch(id);
  if (!data) return new Response("Not found", { status: 404 });

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "export_church",
    summary: `Exported a backup of "${data.church.name}"`,
    targetType: "church",
    targetId: id,
  });

  const date = new Date().toISOString().slice(0, 10);
  const filename = `flockinsight-${slugify(data.church.name) || "church"}-${date}.json`;

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
