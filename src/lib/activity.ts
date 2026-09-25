import "server-only";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import type { AuditSeverity } from "@/lib/audit-catalog";

/**
 * Reading the activity log.
 *
 * Kept apart from lib/audit.ts, which only writes. Writing has to be
 * impossible to get wrong and never throw; reading is a query with filters and
 * paging, and mixing the two would put the reader's imports in front of every
 * server action in the app.
 */

export type ActivityFilters = {
  churchId?: string | null;
  /** "church" for one tenant's own log, "platform" for operator actions. */
  scope?: "church" | "platform" | "all";
  modules?: string[];
  actorUserId?: string | null;
  severity?: AuditSeverity[];
  from?: string | null; // YYYY-MM-DD
  to?: string | null;
  /** Matches the summary, the person's name, or what was acted on. */
  q?: string | null;
  limit?: number;
  /**
   * Keyset cursor: the createdAt of the last row on the previous page.
   *
   * Not an offset. A log grows at the head, so `offset 500` moves backwards
   * every time something is recorded and a reader paging through a busy day
   * sees the same rows twice.
   */
  before?: string | null;
};

export type ActivityRow = {
  id: string;
  scope: string;
  churchId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  actorUserId: string | null;
  viaImpersonation: boolean;
  action: string;
  module: string;
  severity: AuditSeverity;
  summary: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  meta: Record<string, unknown>;
  ip: string | null;
  createdAt: Date;
};

const MAX_LIMIT = 200;

function buildWhere(f: ActivityFilters): SQL | undefined {
  const parts: (SQL | undefined)[] = [];

  if (f.churchId) parts.push(eq(auditLog.churchId, f.churchId));
  if (f.scope && f.scope !== "all") parts.push(eq(auditLog.scope, f.scope));
  if (f.modules?.length) parts.push(inArray(auditLog.module, f.modules));
  if (f.severity?.length) parts.push(inArray(auditLog.severity, f.severity));
  if (f.actorUserId) parts.push(eq(auditLog.actorUserId, f.actorUserId));

  if (f.from) parts.push(gte(auditLog.createdAt, new Date(`${f.from}T00:00:00.000Z`)));
  // Inclusive of the whole "to" day — the off-by-one that quietly drops
  // everything recorded on the last day of a range.
  if (f.to) parts.push(lte(auditLog.createdAt, new Date(`${f.to}T23:59:59.999Z`)));

  if (f.before) {
    const at = new Date(f.before);
    if (!Number.isNaN(at.getTime())) parts.push(sql`${auditLog.createdAt} < ${at}`);
  }

  const q = f.q?.trim();
  if (q) {
    const like = `%${q}%`;
    parts.push(
      or(
        ilike(auditLog.summary, like),
        ilike(auditLog.actorName, like),
        ilike(auditLog.targetLabel, like),
        ilike(auditLog.action, like),
      ),
    );
  }

  const defined = parts.filter((p): p is SQL => !!p);
  return defined.length > 0 ? and(...defined) : undefined;
}

export async function listActivity(
  f: ActivityFilters,
): Promise<{ rows: ActivityRow[]; nextCursor: string | null }> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, f.limit ?? 50));

  const rows = await db
    .select({
      id: auditLog.id,
      scope: auditLog.scope,
      churchId: auditLog.churchId,
      actorName: auditLog.actorName,
      actorEmail: auditLog.actorEmail,
      actorRole: auditLog.actorRole,
      actorUserId: auditLog.actorUserId,
      viaImpersonation: auditLog.viaImpersonation,
      action: auditLog.action,
      module: auditLog.module,
      severity: auditLog.severity,
      summary: auditLog.summary,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      targetLabel: auditLog.targetLabel,
      meta: auditLog.meta,
      ip: auditLog.ip,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(buildWhere(f))
    .orderBy(desc(auditLog.createdAt))
    // One extra, to find out whether there is another page without counting
    // the whole table.
    .limit(limit + 1);

  const page = rows.slice(0, limit) as ActivityRow[];
  const nextCursor =
    rows.length > limit && page.length > 0
      ? page[page.length - 1].createdAt.toISOString()
      : null;

  return { rows: page, nextCursor };
}

/** Everything matching, for a CSV export. Capped so one click can't hurt. */
export async function exportActivity(f: ActivityFilters, cap = 10_000): Promise<ActivityRow[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      scope: auditLog.scope,
      churchId: auditLog.churchId,
      actorName: auditLog.actorName,
      actorEmail: auditLog.actorEmail,
      actorRole: auditLog.actorRole,
      actorUserId: auditLog.actorUserId,
      viaImpersonation: auditLog.viaImpersonation,
      action: auditLog.action,
      module: auditLog.module,
      severity: auditLog.severity,
      summary: auditLog.summary,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      targetLabel: auditLog.targetLabel,
      meta: auditLog.meta,
      ip: auditLog.ip,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(buildWhere(f))
    .orderBy(desc(auditLog.createdAt))
    .limit(cap);
  return rows as ActivityRow[];
}

/** People who have done something here, for the "who" filter. */
export async function activityActors(
  churchId: string | null,
  scope: "church" | "platform" | "all" = "church",
): Promise<{ id: string; name: string }[]> {
  const where = and(
    churchId ? eq(auditLog.churchId, churchId) : undefined,
    scope !== "all" ? eq(auditLog.scope, scope) : undefined,
    sql`${auditLog.actorUserId} is not null`,
  );

  const rows = await db
    .selectDistinct({ id: auditLog.actorUserId, name: auditLog.actorName })
    .from(auditLog)
    .where(where)
    .limit(200);

  return rows
    .filter((r): r is { id: string; name: string } => !!r.id)
    .map((r) => ({ id: r.id, name: r.name || "Someone" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A count per module over a window, for the little summary strip. Grouped
 * aggregate, never a per-module subquery.
 */
export async function activitySummary(
  churchId: string,
  days = 30,
): Promise<{ module: string; n: number }[]> {
  const since = new Date(new Date().getTime() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ module: auditLog.module, n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(and(eq(auditLog.churchId, churchId), gte(auditLog.createdAt, since)))
    .groupBy(auditLog.module)
    .orderBy(desc(sql`count(*)`));
  return rows;
}

/** Everything recorded against one thing — "who touched this member?". */
export async function activityForTarget(
  churchId: string,
  targetType: string,
  targetId: string,
  limit = 50,
): Promise<ActivityRow[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      scope: auditLog.scope,
      churchId: auditLog.churchId,
      actorName: auditLog.actorName,
      actorEmail: auditLog.actorEmail,
      actorRole: auditLog.actorRole,
      actorUserId: auditLog.actorUserId,
      viaImpersonation: auditLog.viaImpersonation,
      action: auditLog.action,
      module: auditLog.module,
      severity: auditLog.severity,
      summary: auditLog.summary,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      targetLabel: auditLog.targetLabel,
      meta: auditLog.meta,
      ip: auditLog.ip,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.churchId, churchId),
        eq(auditLog.targetType, targetType),
        eq(auditLog.targetId, targetId),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
  return rows as ActivityRow[];
}
