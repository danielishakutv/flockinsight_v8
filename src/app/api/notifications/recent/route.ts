import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { getSession } from "@/lib/session";
import { listNotifications } from "@/lib/notifications";

export const dynamic = "force-dynamic";

function json(items: unknown[]) {
  return new Response(JSON.stringify({ items }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// GET /api/notifications/recent → { items } (newest 6) for the bell dropdown.
export async function GET() {
  const data = await getSession();
  const orgId = data?.session.activeOrganizationId;
  if (!data?.user || !orgId) return json([]);

  const [c] = await db
    .select({ plan: church.plan, country: church.country })
    .from(church)
    .where(eq(church.id, orgId))
    .limit(1);
  if (!c) return json([]);

  const items = await listNotifications(
    { churchId: orgId, plan: c.plan, country: c.country, userId: data.user.id },
    { limit: 6 },
  );

  return json(
    items.map((i) => ({
      id: i.id,
      title: i.title,
      body: i.body,
      category: i.category,
      linkUrl: i.linkUrl,
      createdAt: i.createdAt.toISOString(),
      read: i.read,
    })),
  );
}
