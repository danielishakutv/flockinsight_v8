import "server-only";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

/** Record a superadmin action for the audit log. Never throws. */
export async function recordAudit(opts: {
  actorUserId?: string | null;
  actorName?: string | null;
  action: string;
  summary: string;
  targetType?: string | null;
  targetId?: string | null;
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorUserId: opts.actorUserId ?? null,
      actorName: opts.actorName ?? null,
      action: opts.action,
      summary: opts.summary,
      targetType: opts.targetType ?? null,
      targetId: opts.targetId ?? null,
    });
  } catch (e) {
    console.error("[audit] recordAudit failed", e);
  }
}
