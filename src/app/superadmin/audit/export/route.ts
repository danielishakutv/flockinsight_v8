import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import { exportActivity, type ActivityFilters } from "@/lib/activity";
import { CSV_BOM, toCsv } from "@/lib/csv";
import { recordAudit, type AuditSeverity } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /superadmin/audit/export — the platform audit log as a CSV.
 *
 * Downloading it is itself recorded. An audit log that does not note who took
 * a copy of it has a hole in exactly the place it matters.
 */
export async function GET(request: Request) {
  await requirePlatform("platform.audit.view");

  const url = new URL(request.url);
  const one = (k: string) => url.searchParams.get(k)?.trim() || null;
  const scope = one("scope");
  const severity = one("severity");

  const filters: ActivityFilters = {
    scope: scope === "church" ? "church" : scope === "platform" ? "platform" : "all",
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

  const rows = await exportActivity(filters, 50_000);

  const churchIds = [...new Set(rows.map((r) => r.churchId).filter((x): x is string => !!x))];
  const churches = churchIds.length
    ? await db
        .select({ id: church.id, name: church.name })
        .from(church)
        .where(inArray(church.id, churchIds))
    : [];
  const nameById = new Map(churches.map((c) => [c.id, c.name]));

  const csv =
    CSV_BOM +
    toCsv([
      [
        "when",
        "scope",
        "church",
        "who",
        "email",
        "role",
        "area",
        "action",
        "what_happened",
        "target_type",
        "target",
        "importance",
        "via_impersonation",
        "ip_address",
        "details",
      ],
      ...rows.map((r) => [
        r.createdAt.toISOString(),
        r.scope,
        r.churchId ? (nameById.get(r.churchId) ?? r.churchId) : "",
        r.actorName ?? "",
        r.actorEmail ?? "",
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

  await recordAudit({
    action: "platform.audit.export",
    summary: `Downloaded the platform audit log (${rows.length} entries)`,
    targetType: "audit-log",
    meta: { rows: rows.length, filters },
    severity: "warning",
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="flockinsight-audit-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
