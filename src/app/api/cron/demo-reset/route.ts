import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { resetChurch } from "@/lib/church-data";
import { seedDemoData, undoDemoSeed } from "@/lib/demo-seed";
import { getDemoChurch, pruneDemoSessions } from "@/lib/demo";
import { withCronRun } from "@/lib/cron-run";
import { auditSystem } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Seeding touches a dozen tables; generous, but bounded. */
export const maxDuration = 300;

/**
 * GET /api/cron/demo-reset — run every two hours.
 *
 * Wipes the demonstration church and fills it again, so whatever the last
 * visitor did is gone and the next one sees a working church with data in
 * every module.
 *
 * THREE SAFETY RAILS, because this deletes things:
 *
 *  1. It only ever touches the church whose `isDemo` is true, read from the
 *     database at the moment it runs. There is no id in the environment, no
 *     "first church" fallback, and no parameter — nothing a mistyped request
 *     could point at a real congregation.
 *  2. If no church is marked, it does nothing and says so. That is the normal
 *     state until somebody turns it on.
 *  3. It refuses outright if the marked church has a wallet balance or a paid
 *     plan, which is what a real church looks like. A flag set on the wrong
 *     row must not cost somebody their records.
 *
 * Auth via ?key=CRON_SECRET or a Bearer header.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const key =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("key");
  if (!secret || key !== secret) return new Response("Unauthorized", { status: 401 });

  return withCronRun("demo-reset", async () => {
    const demo = await getDemoChurch();
    if (!demo) {
      return json({ ok: true, skipped: "no church is marked as the demo" });
    }

    const [row] = await db
      .select({
        id: church.id,
        name: church.name,
        plan: church.plan,
        walletBalance: church.walletBalance,
        planRenewsAt: church.planRenewsAt,
      })
      .from(church)
      .where(eq(church.id, demo.id))
      .limit(1);
    if (!row) return json({ ok: true, skipped: "the demo church has gone" });

    /*
     * Does this look like somebody's real church?
     *
     * Money is the tell. A demo church never pays and never tops up a wallet,
     * so either of those means the flag is on the wrong row — and the right
     * response is to refuse and be noisy, not to wipe it and find out later.
     */
    const paid =
      Number(row.walletBalance) > 0 ||
      (row.planRenewsAt != null && row.planRenewsAt.getTime() > Date.now());
    if (paid) {
      console.error(
        `[demo-reset] REFUSED: "${row.name}" is marked as the demo but has money on it. Nothing was deleted.`,
      );
      await auditSystem({
        action: "platform.demo.refused",
        summary: `Refused to reset "${row.name}" as the demo church — it has a balance or a paid plan`,
        targetType: "church",
        targetId: row.id,
        severity: "critical",
      });
      return json(
        { ok: false, error: "The church marked as the demo has money on it." },
        409,
      );
    }

    /*
     * Undo the previous seed first, then clear what visitors left behind.
     *
     * The order matters: undoDemoSeed removes exactly the rows the manifest
     * lists, and resetChurch then clears everything else operational — the
     * members a visitor added, the attendance they recorded. Doing it the
     * other way round would leave the manifest pointing at rows that are
     * already gone, which is harmless but makes the logs lie.
     */
    const undone = await undoDemoSeed(row.id);
    await resetChurch(row.id);
    const seeded = await seedDemoData(row.id);
    const pruned = await pruneDemoSessions(row.id);

    console.log(
      `[demo-reset] "${row.name}": previous seed ${undone.ok ? "removed" : "not found"}, ${seeded.length} steps re-seeded, ${pruned} old visitor session(s) pruned`,
    );

    return json({
      ok: true,
      church: row.name,
      removedPrevious: undone.ok,
      seeded: seeded.length,
      prunedSessions: pruned,
    });
  });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
