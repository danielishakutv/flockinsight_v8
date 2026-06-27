import { eq } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { ensureMemberForUser } from "@/lib/member-link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * One-time (idempotent) backfill: enroll every existing team member as a
 * congregation member — linking to an existing member by email, or creating a
 * profile. Safe to run multiple times (already-linked staff are skipped).
 *
 * GET /api/admin/backfill-members?key=CRON_SECRET
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

  // Real memberships only — skip temporary superadmin "act as" rows.
  const rows = await db
    .select({ churchId: staff.organizationId, userId: staff.userId })
    .from(staff)
    .where(eq(staff.temp, false));

  let processed = 0;
  for (const r of rows) {
    await ensureMemberForUser(r.churchId, r.userId);
    processed++;
  }

  return new Response(
    JSON.stringify({ ok: true, staff: rows.length, processed }),
    { headers: { "Content-Type": "application/json" } },
  );
}
