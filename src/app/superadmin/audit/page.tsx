import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import {
  activityActors,
  listActivity,
  type ActivityFilters,
} from "@/lib/activity";
import { AUDIT_MODULE_LABEL, type AuditSeverity } from "@/lib/audit-catalog";
import { ActivityLog, type ActivityEntry } from "@/components/settings/activity-log";

export const metadata = { title: "Audit log · Admin" };
export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export default async function AuditPage({ searchParams }: { searchParams: Search }) {
  await requirePlatform("platform.audit.view");

  const sp = await searchParams;
  const scopeParam = one(sp.scope);
  const severityParam = one(sp.severity);

  /*
   * Platform actions and church actions are one table and one page.
   *
   * Splitting them would mean a support engineer investigating "somebody
   * deleted our giving records" has to know in advance which of two logs to
   * open — and an operator acting as a church writes a church-scoped row, so
   * the interesting cases fall on the other side of the split.
   */
  const filters: ActivityFilters = {
    scope:
      scopeParam === "church" ? "church" : scopeParam === "platform" ? "platform" : "all",
    modules: one(sp.module) ? [one(sp.module) as string] : undefined,
    actorUserId: one(sp.who),
    severity:
      severityParam === "warning"
        ? (["warning", "critical"] as AuditSeverity[])
        : severityParam === "critical"
          ? (["critical"] as AuditSeverity[])
          : undefined,
    from: one(sp.from),
    to: one(sp.to),
    q: one(sp.q),
    before: one(sp.before),
    limit: 100,
  };

  const [{ rows, nextCursor }, actors] = await Promise.all([
    listActivity(filters),
    activityActors(null, "all"),
  ]);

  // Church names in one query, joined in JS — never a correlated subquery.
  const churchIds = [...new Set(rows.map((r) => r.churchId).filter((x): x is string => !!x))];
  const churches = churchIds.length
    ? await db
        .select({ id: church.id, name: church.name })
        .from(church)
        .where(inArray(church.id, churchIds))
    : [];
  const nameById = new Map(churches.map((c) => [c.id, c.name]));

  const entries: ActivityEntry[] = rows.map((r) => ({
    id: r.id,
    churchName: r.churchId ? (nameById.get(r.churchId) ?? null) : null,
    actorName: r.actorName,
    actorRole: r.actorRole,
    viaImpersonation: r.viaImpersonation,
    action: r.action,
    module: r.module,
    severity: r.severity,
    summary: r.summary,
    targetLabel: r.targetLabel,
    meta: r.meta ?? {},
    ip: r.ip,
    createdAt: r.createdAt.toISOString(),
  }));

  const exportParams = new URLSearchParams();
  for (const key of ["module", "who", "severity", "from", "to", "q", "scope"]) {
    const v = one(sp[key]);
    if (v) exportParams.set(key, v);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Everything recorded across the platform — operator actions in here,
          and what churches do inside their own workspaces. Nothing is ever
          edited or removed.
        </p>
      </div>

      <ScopeTabs current={filters.scope ?? "all"} />

      <ActivityLog
        entries={entries}
        modules={Object.keys(AUDIT_MODULE_LABEL)}
        actors={actors}
        nextCursor={nextCursor}
        exportHref={`/superadmin/audit/export?${exportParams.toString()}`}
        showChurch
      />
    </div>
  );
}

function ScopeTabs({ current }: { current: string }) {
  const tabs = [
    { key: "all", label: "Everything" },
    { key: "platform", label: "Platform admin" },
    { key: "church", label: "Inside churches" },
  ];
  return (
    <div className="flex gap-1.5">
      {tabs.map((t) => (
        <a
          key={t.key}
          href={t.key === "all" ? "?" : `?scope=${t.key}`}
          className={
            current === t.key
              ? "bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-sm font-semibold"
              : "text-muted-foreground hover:bg-muted rounded-lg px-3 py-1.5 text-sm font-medium"
          }
        >
          {t.label}
        </a>
      ))}
    </div>
  );
}
