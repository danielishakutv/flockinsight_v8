import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { form, formResponse, member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { toCsv, CSV_BOM } from "@/lib/csv";
import { displayValue, type FormField, type FieldValue } from "@/lib/forms-shared";
import { slugify } from "@/lib/slug";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /forms/[id]/responses/export -> CSV of all responses.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });

  const { church } = await requireChurch();
  if (!(await can("forms.view")))
    return new Response("Forbidden", { status: 403 });

  const [f] = await db
    .select({ title: form.title, fields: form.fields })
    .from(form)
    .where(and(eq(form.id, id), eq(form.churchId, church.id)))
    .limit(1);
  if (!f) return new Response("Not found", { status: 404 });

  const rows = await db
    .select({
      data: formResponse.data,
      createdAt: formResponse.createdAt,
      firstName: member.firstName,
      lastName: member.lastName,
    })
    .from(formResponse)
    .leftJoin(member, eq(member.id, formResponse.memberId))
    .where(eq(formResponse.formId, id))
    .orderBy(asc(formResponse.createdAt));

  const fields = (f.fields ?? []) as FormField[];
  const header = [...fields.map((x) => x.label), "Linked member", "Submitted at"];
  const body = rows.map((r) => {
    const data = (r.data ?? {}) as Record<string, FieldValue>;
    const memberName = [r.firstName, r.lastName].filter(Boolean).join(" ");
    return [
      ...fields.map((x) => displayValue(data[x.id] ?? null)),
      memberName,
      r.createdAt.toISOString(),
    ];
  });

  const csv = CSV_BOM + toCsv([header, ...body]);
  const filename = `${slugify(f.title) || "form"}-responses.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
