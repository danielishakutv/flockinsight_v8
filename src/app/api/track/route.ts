import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, staff } from "@/db/schema";
import { getSession } from "@/lib/session";
import { recordPageview } from "@/lib/analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noContent = () => new Response(null, { status: 204 });

/**
 * POST /api/track — first-party pageview beacon from the app shell. Identity is
 * resolved server-side from the session (never trusts the client for who/which
 * church). Always returns 204 and never throws, so it can't disrupt the app.
 */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    const body = raw ? (JSON.parse(raw) as { path?: string; sid?: string }) : {};
    const path = typeof body.path === "string" ? body.path : "";
    if (!path || path.length > 300) return noContent();

    const data = await getSession();
    if (!data?.user) return noContent(); // only track signed-in product usage

    const churchId = data.session.activeOrganizationId ?? null;
    let plan: string | null = null;
    let role: string | null = null;
    if (churchId) {
      const [row] = await db
        .select({ plan: church.plan, role: staff.role })
        .from(church)
        .leftJoin(
          staff,
          and(eq(staff.organizationId, church.id), eq(staff.userId, data.user.id)),
        )
        .where(eq(church.id, churchId))
        .limit(1);
      plan = row?.plan ?? null;
      role = row?.role ?? null;
    }

    await recordPageview({
      churchId,
      userId: data.user.id,
      sessionId: typeof body.sid === "string" ? body.sid.slice(0, 60) : null,
      path,
      plan,
      role,
    });
  } catch {
    /* analytics must never break navigation */
  }
  return noContent();
}
