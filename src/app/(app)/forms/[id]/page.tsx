import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { event, form } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";
import { PageContainer } from "@/components/app/page-header";
import { FormBuilder } from "@/components/forms/form-builder";

export const metadata = { title: "Edit form" };

export default async function FormEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const { church } = await requireChurch();
  await requireCan("forms.manage");

  const [[f], events] = await Promise.all([
    db
      .select()
      .from(form)
      .where(and(eq(form.id, id), eq(form.churchId, church.id)))
      .limit(1),
    db
      .select({ id: event.id, title: event.title })
      .from(event)
      .where(eq(event.churchId, church.id))
      .orderBy(desc(event.date))
      .limit(200),
  ]);
  if (!f) notFound();

  return (
    <PageContainer className="max-w-3xl">
      <FormBuilder
        baseUrl={siteUrl()}
        events={events}
        initial={{
          id: f.id,
          title: f.title,
          description: f.description ?? "",
          slug: f.slug,
          status: f.status,
          fields: f.fields ?? [],
          confirmationMessage: f.confirmationMessage,
          notifyEmail: f.notifyEmail,
          notifyInApp: f.notifyInApp,
          createMembers: f.createMembers,
          addToFollowUp: f.addToFollowUp,
          eventId: f.eventId ?? "",
          responseCount: f.responseCount,
        }}
      />
    </PageContainer>
  );
}
