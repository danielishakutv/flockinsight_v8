import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { AuditList } from "@/components/superadmin/audit-list";

export const metadata = { title: "Audit log · Admin" };

export default async function AuditPage() {
  const rows = await db
    .select({
      id: auditLog.id,
      actorName: auditLog.actorName,
      action: auditLog.action,
      summary: auditLog.summary,
      targetType: auditLog.targetType,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(300);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Audit log
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          A record of actions taken in the platform admin.
        </p>
      </div>
      <AuditList
        entries={rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
