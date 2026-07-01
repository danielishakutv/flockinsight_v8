import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { form, formResponse, member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/forms/[id]/responses?after=<ISO> -> newest responses (for live poll).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });

  const { church } = await requireChurch();
  if (!(await can("forms.view")))
    return new Response("Forbidden", { status: 403 });

  const [f] = await db
    .select({ id: form.id })
    .from(form)
    .where(and(eq(form.id, id), eq(form.churchId, church.id)))
    .limit(1);
  if (!f) return new Response("Not found", { status: 404 });

  const afterRaw = new URL(req.url).searchParams.get("after");
  const after = afterRaw ? new Date(afterRaw) : null;
  const validAfter = after && !isNaN(after.getTime()) ? after : null;

  const where = validAfter
    ? and(eq(formResponse.formId, id), gt(formResponse.createdAt, validAfter))
    : eq(formResponse.formId, id);

  const rows = await db
    .select({
      id: formResponse.id,
      data: formResponse.data,
      memberId: formResponse.memberId,
      firstName: member.firstName,
      lastName: member.lastName,
      createdAt: formResponse.createdAt,
    })
    .from(formResponse)
    .leftJoin(member, eq(member.id, formResponse.memberId))
    .where(where)
    .orderBy(desc(formResponse.createdAt))
    .limit(200);

  return new Response(
    JSON.stringify({
      responses: rows.map((r) => ({
        id: r.id,
        data: r.data ?? {},
        memberId: r.memberId,
        memberName: [r.firstName, r.lastName].filter(Boolean).join(" "),
        createdAt: r.createdAt.toISOString(),
      })),
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}
