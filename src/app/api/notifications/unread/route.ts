import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { getSession } from "@/lib/session";
import { unreadCount } from "@/lib/notifications";

export const dynamic = "force-dynamic";

function json(count: number) {
  return new Response(JSON.stringify({ count }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// GET /api/notifications/unread → { count } for the signed-in user's church.
export async function GET() {
  const data = await getSession();
  const orgId = data?.session.activeOrganizationId;
  if (!data?.user || !orgId) return json(0);

  const [c] = await db
    .select({ plan: church.plan, country: church.country })
    .from(church)
    .where(eq(church.id, orgId))
    .limit(1);
  if (!c) return json(0);

  const count = await unreadCount({
    churchId: orgId,
    plan: c.plan,
    country: c.country,
    userId: data.user.id,
  });
  return json(count);
}
