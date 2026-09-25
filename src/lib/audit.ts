import "server-only";
import { after } from "next/server";
import { headers } from "next/headers";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import {
  moduleOf,
  sanitiseMeta,
  severityFor,
  type AuditScope,
  type AuditSeverity,
} from "@/lib/audit-catalog";

export * from "@/lib/audit-catalog";

/* ============================================================
 * Writing
 *
 * Two rules hold everywhere in this file:
 *
 *  1. An audit write NEVER fails the thing it is describing. A member is saved
 *     whether or not we managed to record that she was. So every path is
 *     wrapped, and failures go to the console.
 *  2. It never slows it down either. Writes are handed to `after()`, so the
 *     response is already on its way when the row is inserted.
 * ========================================================== */

type BaseEntry = {
  action: string;
  summary: string;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  meta?: Record<string, unknown> | null;
  severity?: AuditSeverity;
  module?: string;
};

type WriteEntry = BaseEntry & {
  scope: AuditScope;
  churchId?: string | null;
  actorUserId?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  viaImpersonation?: boolean;
  ip?: string | null;
  userAgent?: string | null;
};

/** The one place that actually inserts. Never throws. */
async function write(entry: WriteEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      scope: entry.scope,
      churchId: entry.churchId ?? null,
      actorUserId: entry.actorUserId ?? null,
      actorName: entry.actorName ?? null,
      actorEmail: entry.actorEmail ?? null,
      actorRole: entry.actorRole ?? null,
      viaImpersonation: entry.viaImpersonation ?? false,
      action: entry.action,
      module: entry.module ?? moduleOf(entry.action),
      severity: entry.severity ?? severityFor(entry.action),
      summary: entry.summary.slice(0, 2000),
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ? String(entry.targetId).slice(0, 200) : null,
      targetLabel: entry.targetLabel ? entry.targetLabel.slice(0, 300) : null,
      meta: sanitiseMeta(entry.meta),
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ? entry.userAgent.slice(0, 400) : null,
    });
  } catch (e) {
    console.error("[audit] write failed", entry.action, e);
  }
}

/**
 * Queue the insert behind the response where we can, and fall back to awaiting
 * it where we can't. `after()` throws outside a request scope (a cron tick
 * calling a shared helper, a script), and an audit trail that quietly stops
 * recording in exactly those cases would be worse than a slightly slower one.
 */
function enqueue(entry: WriteEntry): void {
  try {
    after(() => write(entry));
  } catch {
    void write(entry);
  }
}

/* ============================================================
 * Who did it
 * ========================================================== */

type Actor = {
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  viaImpersonation: boolean;
};

const SYSTEM_ACTOR: Actor = {
  actorUserId: null,
  actorName: "FlockInsight",
  actorEmail: null,
  actorRole: "system",
  viaImpersonation: false,
};

/**
 * Read the caller off the current request.
 *
 * Imported lazily: lib/session.ts pulls in Better Auth and the whole org
 * plugin, and audit.ts is imported by nearly every action file. A static
 * import here would put that graph in front of every one of them.
 */
async function currentActor(): Promise<Actor> {
  try {
    const { getSession, getIsSuperAdmin, getActAsChurchId } = await import(
      "@/lib/session"
    );
    const data = await getSession();
    if (!data?.user) return { ...SYSTEM_ACTOR, actorName: "Guest", actorRole: "guest" };

    const [impersonating, isSuper] = await Promise.all([
      getActAsChurchId(),
      getIsSuperAdmin(),
    ]);

    let role: string | null = isSuper ? "platform admin" : null;
    if (!impersonating && !isSuper) {
      try {
        const { getAccess } = await import("@/lib/permissions");
        const access = await getAccess();
        role = access.isOwner ? "owner" : (access.staffRole ?? null);
      } catch {
        /* role is a nicety; never block the entry for it */
      }
    }

    return {
      actorUserId: data.user.id,
      actorName: data.user.name || data.user.email,
      actorEmail: data.user.email ?? null,
      actorRole: role,
      viaImpersonation: !!impersonating,
    };
  } catch {
    return SYSTEM_ACTOR;
  }
}

/**
 * Where from. `cf-connecting-ip` is the only header on this deployment that a
 * client cannot forge — see the note in lib/auth.ts about why x-forwarded-for
 * is not trusted here.
 */
async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    return {
      ip: h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? null,
      userAgent: h.get("user-agent"),
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/* ============================================================
 * The API
 * ========================================================== */

/**
 * Record a platform-admin action. The original signature, unchanged — every
 * existing /superadmin caller keeps working.
 */
export async function recordAudit(opts: {
  actorUserId?: string | null;
  actorName?: string | null;
  action: string;
  summary: string;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  churchId?: string | null;
  meta?: Record<string, unknown> | null;
  severity?: AuditSeverity;
}): Promise<void> {
  const [actor, ctx] = await Promise.all([currentActor(), requestContext()]);
  enqueue({
    scope: "platform",
    ...actor,
    // An explicitly passed actor wins — some callers know better than the
    // session does (a cron acting for someone, a support tool).
    actorUserId: opts.actorUserId ?? actor.actorUserId,
    actorName: opts.actorName ?? actor.actorName,
    churchId: opts.churchId ?? null,
    action: opts.action,
    summary: opts.summary,
    targetType: opts.targetType,
    targetId: opts.targetId,
    targetLabel: opts.targetLabel,
    meta: opts.meta,
    severity: opts.severity,
    ...ctx,
  });
}

/**
 * Record something that happened inside a church.
 *
 * This is the one nearly every server action calls. It resolves the actor from
 * the session itself, so a caller only has to say what happened:
 *
 *     await audit({
 *       churchId: church.id,
 *       action: "members.member.create",
 *       summary: `Added ${name} to the members list`,
 *       targetType: "member",
 *       targetId: row.id,
 *       targetLabel: name,
 *     });
 */
export async function audit(opts: BaseEntry & { churchId: string }): Promise<void> {
  const [actor, ctx] = await Promise.all([currentActor(), requestContext()]);
  enqueue({ scope: "church", ...actor, ...ctx, ...opts });
}

/**
 * Record an action with no signed-in user behind it — a cron run, a webhook, a
 * public form submission. `actorName` is what the log shows instead of a person.
 */
export async function auditSystem(
  opts: BaseEntry & { churchId?: string | null; actorName?: string },
): Promise<void> {
  const ctx = await requestContext();
  enqueue({
    scope: opts.churchId ? "church" : "platform",
    ...SYSTEM_ACTOR,
    actorName: opts.actorName ?? SYSTEM_ACTOR.actorName,
    ...ctx,
    ...opts,
  });
}

/**
 * Record an action taken by someone identified but not signed in — a guest in
 * a meeting, someone filling in a public form. They are named, and clearly not
 * an account.
 */
export async function auditGuest(
  opts: BaseEntry & { churchId: string; guestName: string },
): Promise<void> {
  const ctx = await requestContext();
  const { guestName, ...rest } = opts;
  enqueue({
    scope: "church",
    actorUserId: null,
    actorName: guestName,
    actorEmail: null,
    actorRole: "guest",
    viaImpersonation: false,
    ...ctx,
    ...rest,
  });
}
