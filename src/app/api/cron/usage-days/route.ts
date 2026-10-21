import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { platformCertificate } from "@/db/schema";
import { withCronRun } from "@/lib/cron-run";
import { rollupActiveDays } from "@/lib/active-days";
import { issueEarnedCertificates } from "@/lib/certification";
import type { CertRank } from "@/lib/certification-shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/usage-days — daily, after midnight UTC.
 *
 * Rolls yesterday's real use into user_active_day before the 180-day
 * analytics prune can reach it, then issues any Master or Expert rank that a
 * Professional active in that window has just crossed. Only a Professional
 * can cross into either, so the work is bounded by the people who were
 * active, not by everybody who ever signed up.
 *
 * Sends no SMS and no email, so the SMS window does not apply. The JSON keys
 * avoid the words cron-meta strips (anything containing "user", "member"...),
 * or the health page would never show them.
 *
 * Auth via an `Authorization: Bearer <CRON_SECRET>` header, or `?key=` —
 * prefer the header, because a query string is written to the access log.
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

  return withCronRun("usage-days", async () => {
    const rollup = await rollupActiveDays();

    const holders = new Set<string>();
    for (let i = 0; i < rollup.userIds.length; i += 500) {
      const part = rollup.userIds.slice(i, i + 500);
      const rows = await db
        .select({ userId: platformCertificate.userId })
        .from(platformCertificate)
        .where(
          and(
            eq(platformCertificate.rank, "professional"),
            isNull(platformCertificate.revokedAt),
            inArray(platformCertificate.userId, part),
          ),
        );
      for (const r of rows) holders.add(r.userId);
    }

    const ranksIssued: Record<CertRank, number> = { professional: 0, master: 0, expert: 0 };
    let failures = 0;
    for (const id of holders) {
      // One person's failure must not cost everybody after them their rank.
      try {
        for (const rank of await issueEarnedCertificates(id, { churchId: null })) ranksIssued[rank]++;
      } catch (e) {
        failures++;
        console.error("[cron/usage-days] rank issue failed for", id, e);
      }
    }

    return Response.json({
      ok: true,
      from: rollup.from.toISOString(),
      daysWritten: rollup.rows,
      peopleActive: rollup.userIds.length,
      professionalsChecked: holders.size,
      ranksIssued,
      failures,
    });
  });
}
