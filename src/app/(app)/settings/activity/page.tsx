import { redirect } from "next/navigation";
import { requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import {
  activityActors,
  activitySummary,
  listActivity,
  type ActivityFilters,
} from "@/lib/activity";
import { AUDIT_MODULE_LABEL, type AuditSeverity } from "@/lib/audit-catalog";
import { ActivityLog, type ActivityEntry } from "@/components/settings/activity-log";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Activity log · Settings" };
export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export default async function ActivityPage({ searchParams }: { searchParams: Search }) {
  const { church } = await requireChurch();
  const access = await getAccess();

  /*
   * The activity log names people and shows what they changed, so it answers
   * to the same permission as the rest of the church's administration rather
   * than to any one module. Someone who can only see Giving has no business
   * reading who edited whose phone number.
   */
  const canRead = access.isOwner || access.perms.has("settings.manage");
  if (!canRead) redirect("/dashboard");

  const sp = await searchParams;
  const severityParam = one(sp.severity);

  const filters: ActivityFilters = {
    churchId: church.id,
    scope: "church",
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
    limit: 50,
  };

  const [{ rows, nextCursor }, actors, summary] = await Promise.all([
    listActivity(filters),
    activityActors(church.id, "church"),
    activitySummary(church.id, 30),
  ]);

  const entries: ActivityEntry[] = rows.map((r) => ({
    id: r.id,
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

  // Only offer a filter for areas that have something in them.
  const modules = summary.map((s) => s.module).filter((m) => AUDIT_MODULE_LABEL[m]);

  const exportParams = new URLSearchParams();
  for (const key of ["module", "who", "severity", "from", "to", "q"]) {
    const v = one(sp[key]);
    if (v) exportParams.set(key, v);
  }

  const total = summary.reduce((n, s) => n + s.n, 0);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">Activity log</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Everything that happens in your church&apos;s workspace — who did it,
          what changed, and when. Nothing here is ever edited or removed, by us
          or by anyone.
        </p>
      </div>

      {total > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                Last 30 days
              </p>
              <p className="text-2xl font-extrabold">{total.toLocaleString()}</p>
            </div>
            {summary.slice(0, 5).map((s) => (
              <div key={s.module}>
                <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                  {AUDIT_MODULE_LABEL[s.module] ?? s.module}
                </p>
                <p className="text-lg font-bold">{s.n.toLocaleString()}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <ActivityLog
        entries={entries}
        modules={modules}
        actors={actors}
        nextCursor={nextCursor}
        exportHref={`/settings/activity/export?${exportParams.toString()}`}
      />
    </div>
  );
}
