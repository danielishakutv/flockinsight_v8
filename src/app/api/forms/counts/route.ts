import { eq } from "drizzle-orm";
import { db } from "@/db";
import { form } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/forms/counts -> { counts: { [formId]: responseCount } }
// Lightweight, church-scoped poll target so form views can show live counts.
export async function GET() {
  const { church } = await requireChurch();
  if (!(await can("forms.view")))
    return new Response("Forbidden", { status: 403 });

  const rows = await db
    .select({ id: form.id, count: form.responseCount })
    .from(form)
    .where(eq(form.churchId, church.id));

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.id] = r.count;

  return new Response(JSON.stringify({ counts }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
