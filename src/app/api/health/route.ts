import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/health — liveness for the deploy and the watchdog.
 *
 * Public and deliberately cheap: it reports which build is answering, so a
 * deploy can tell the new release apart from the one it replaced. Add
 * `?key=CRON_SECRET` for the deeper check that also proves the database is
 * reachable — kept behind the secret so nobody can make us hit Postgres.
 */
export async function GET(request: Request) {
  const deep =
    Boolean(process.env.CRON_SECRET) &&
    new URL(request.url).searchParams.get("key") === process.env.CRON_SECRET;

  let database: "ok" | "unreachable" | "unchecked" = "unchecked";
  if (deep) {
    try {
      await db.execute(sql`select 1`);
      database = "ok";
    } catch {
      database = "unreachable";
    }
  }

  return Response.json(
    {
      ok: database !== "unreachable",
      // Set per release by the deploy script; absent on a local build.
      deployment: process.env.DEPLOYMENT_ID ?? null,
      database,
      uptime: Math.round(process.uptime()),
    },
    {
      status: database === "unreachable" ? 503 : 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
