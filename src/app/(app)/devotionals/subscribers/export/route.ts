import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriber } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { toCsv, CSV_BOM } from "@/lib/csv";

export const runtime = "nodejs";

// GET /devotionals/subscribers/export -> CSV of the church's subscribers.
export async function GET() {
  const { church } = await requireChurch();
  if (!(await can("devotionals.view")))
    return new Response("Forbidden", { status: 403 });

  const rows = await db
    .select({
      name: subscriber.name,
      email: subscriber.email,
      status: subscriber.status,
      source: subscriber.source,
      createdAt: subscriber.createdAt,
    })
    .from(subscriber)
    .where(eq(subscriber.churchId, church.id))
    .orderBy(asc(subscriber.createdAt));

  const header = ["Name", "Email", "Status", "Source", "Subscribed at"];
  const body = rows.map((r) => [
    r.name ?? "",
    r.email,
    r.status,
    r.source,
    r.createdAt.toISOString(),
  ]);

  const csv = CSV_BOM + toCsv([header, ...body]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="subscribers.csv"`,
    },
  });
}
