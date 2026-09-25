import { requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { exportActivity, type ActivityFilters } from "@/lib/activity";
import { CSV_BOM, toCsv } from "@/lib/csv";
import { audit, type AuditSeverity } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /settings/activity/export — the activity log as a CSV.
 *
 * The download is itself audited. Somebody taking a copy of who-did-what out
 * of the system is exactly the kind of event an audit log exists to record,
 * and leaving it out would be a hole in the middle of the feature.
 */
export async function GET(request: Request) {
  const { church } = await requireChurch();
  const access = await getAccess();
  if (!access.isOwner && !access.perms.has("settings.manage")) {
    return new Response("Not allowed", { status: 403 });
  }

  const url = new URL(request.url);
  const one = (k: string) => url.searchParams.get(k)?.trim() || null;
  const severity = one("severity");

  const filters: ActivityFilters = {
    churchId: church.id,
    scope: "church",
    modules: one("module") ? [one("module") as string] : undefined,
    actorUserId: one("who"),
    severity:
      severity === "warning"
        ? (["warning", "critical"] as AuditSeverity[])
        : severity === "critical"
          ? (["critical"] as AuditSeverity[])
          : undefined,
    from: one("from"),
    to: one("to"),
    q: one("q"),
  };

  const rows = await exportActivity(filters);

  const csv =
    CSV_BOM +
    toCsv([
      [
        "when",
        "who",
        "role",
        "area",
        "action",
        "what_happened",
        "target_type",
        "target",
        "importance",
        "via_flockinsight_support",
        "ip_address",
        "details",
      ],
      ...rows.map((r) => [
        r.createdAt.toISOString(),
        r.actorName ?? "",
        r.actorRole ?? "",
        r.module,
        r.action,
        r.summary,
        r.targetType ?? "",
        r.targetLabel ?? r.targetId ?? "",
        r.severity,
        r.viaImpersonation ? "yes" : "no",
        r.ip ?? "",
        r.meta && Object.keys(r.meta).length > 0 ? JSON.stringify(r.meta) : "",
      ]),
    ]);

  await audit({
    churchId: church.id,
    action: "settings.activity.export",
    summary: `Downloaded the activity log (${rows.length} entr${rows.length === 1 ? "y" : "ies"})`,
    targetType: "activity-log",
    meta: { rows: rows.length, filters: { ...filters, churchId: undefined } },
    severity: "warning",
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="activity-log-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
