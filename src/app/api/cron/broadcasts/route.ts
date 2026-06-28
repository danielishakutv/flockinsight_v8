import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { broadcast } from "@/db/schema";
import { deliverBroadcast } from "@/lib/broadcasts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/broadcasts — run every few minutes. Delivers any scheduled
 * broadcasts whose time has come. Auth via ?key=CRON_SECRET or Bearer header.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const key =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("key");
  if (!secret || key !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const due = await db
    .select()
    .from(broadcast)
    .where(and(eq(broadcast.status, "scheduled"), lte(broadcast.scheduledAt, new Date())))
    .limit(50);

  let delivered = 0;
  let emails = 0;
  let push = 0;
  for (const b of due) {
    // Claim it first so a concurrent run can't double-send.
    const [claimed] = await db
      .update(broadcast)
      .set({ status: "sent", sentAt: new Date() })
      .where(and(eq(broadcast.id, b.id), eq(broadcast.status, "scheduled")))
      .returning({ id: broadcast.id });
    if (!claimed) continue;

    try {
      const res = await deliverBroadcast({
        title: b.title,
        body: b.body,
        category: b.category,
        audience: b.audience as "all" | "plan" | "country" | "churches",
        targetPlan: b.targetPlan,
        targetCountry: b.targetCountry,
        churchIds: b.churchIds ?? [],
        linkUrl: b.linkUrl,
        inApp: b.inApp,
        email: b.email,
        createdBy: b.createdBy,
      });
      emails += res.emailSent;
      push += res.pushSent;
      delivered++;
      await db
        .update(broadcast)
        .set({ pushSent: res.pushSent, emailSent: res.emailSent })
        .where(eq(broadcast.id, b.id));
    } catch (e) {
      console.error("[cron] broadcast delivery failed", b.id, e);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, delivered, emails, push }),
    { headers: { "Content-Type": "application/json" } },
  );
}
