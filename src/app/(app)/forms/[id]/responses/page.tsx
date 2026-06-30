import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ArrowLeft, Download, Inbox, UserRound } from "lucide-react";
import { format } from "date-fns";
import { db } from "@/db";
import { form, formResponse, member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { displayValue, type FormField } from "@/lib/forms-shared";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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
      <PageHeader
        title={f.title}
        description={`${rows.length} response${rows.length === 1 ? "" : "s"}`}
        action={
          rows.length > 0 ? (
            <Button asChild variant="outline" size="sm">
              <a href={`/forms/${id}/responses/export`}>
                <Download className="size-4" /> Export CSV
              </a>
            </Button>
          ) : undefined
        }
      />

      {rows.length === 0 ? (
        <div className="text-muted-foreground rounded-2xl border border-dashed py-16 text-center">
          <Inbox className="mx-auto mb-3 size-8 opacity-60" />
          No responses yet. Share the form link to start collecting.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const data = (r.data ?? {}) as Record<string, unknown>;
            const memberName = [r.firstName, r.lastName].filter(Boolean).join(" ");
            return (
              <Card key={r.id}>
                <CardContent className="space-y-3 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-muted-foreground text-xs">
                      {format(r.createdAt, "MMM d, yyyy · h:mm a")}
                    </p>
                    {r.memberId && (
                      <Link
                        href={`/members/${r.memberId}`}
                        className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
                      >
                        <UserRound className="size-3.5" />
                        {memberName || "Member"}
                      </Link>
                    )}
                  </div>
                  <dl className="divide-y">
                    {fields.map((field) => (
                      <div
                        key={field.id}
                        className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-4"
                      >
                        <dt className="text-muted-foreground w-48 shrink-0 text-sm">
                          {field.label}
                        </dt>
                        <dd className="text-sm font-medium">
                          {displayValue(
                            (data[field.id] as never) ?? null,
                          ) || "—"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
