import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { devotional } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { PageContainer } from "@/components/app/page-header";
import { DevotionalEditor } from "@/components/devotionals/devotional-editor";

export const metadata = { title: "Edit devotional" };

export default async function DevotionalEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const { church } = await requireChurch();
  await requireCan("devotionals.manage");

  const [d] = await db
    .select()
    .from(devotional)
    .where(and(eq(devotional.id, id), eq(devotional.churchId, church.id)))
    .limit(1);
  if (!d) notFound();

  return (
    <PageContainer className="max-w-2xl">
      <DevotionalEditor
        initial={{
          id: d.id,
          type: d.type,
          title: d.title,
          body: d.body,
          imageUrl: d.imageUrl,
          audience: d.audience as "subscribers" | "members" | "both",
          status: d.status,
          scheduledAt: d.scheduledAt ? d.scheduledAt.toISOString() : null,
          recipients: d.recipients,
          sentCount: d.sentCount,
        }}
      />
    </PageContainer>
  );
}
