import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db";
import { form, formResponse, member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { type FormField, type FieldValue } from "@/lib/forms-shared";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { FormResponsesLive } from "@/components/forms/form-responses-live";

export const metadata = { title: "Responses" };

export default async function FormResponsesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const { church } = await requireChurch();
  await requireCan("forms.view");

  const [f] = await db
    .select({ id: form.id, title: form.title, fields: form.fields })
    .from(form)
    .where(and(eq(form.id, id), eq(form.churchId, church.id)))
    .limit(1);
  if (!f) notFound();

  const rows = await db
    .select({
      id: formResponse.id,
      data: formResponse.data,
      memberId: formResponse.memberId,
      createdAt: formResponse.createdAt,
      firstName: member.firstName,
      lastName: member.lastName,
    })
    .from(formResponse)
    .leftJoin(member, eq(member.id, formResponse.memberId))
    .where(eq(formResponse.formId, id))
    .orderBy(desc(formResponse.createdAt))
    .limit(500);

  const fields = (f.fields ?? []) as FormField[];

  return (
    <PageContainer className="max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/forms">
          <ArrowLeft className="size-4" /> Forms
        </Link>
      </Button>
      <PageHeader title={f.title} description="Responses update live as they come in." />

      <FormResponsesLive
        formId={id}
        fields={fields}
        initial={rows.map((r) => ({
          id: r.id,
          data: (r.data ?? {}) as Record<string, FieldValue>,
          memberId: r.memberId,
          memberName: [r.firstName, r.lastName].filter(Boolean).join(" "),
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </PageContainer>
  );
}
