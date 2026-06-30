import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { form } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan, getAccess } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { FormsList } from "@/components/forms/forms-list";

export const metadata = { title: "Forms" };

export default async function FormsPage() {
  const { church } = await requireChurch();
  await requireCan("forms.view");
  const access = await getAccess();
  const canManage = access.isOwner || access.perms.has("forms.manage");

  const rows = await db
    .select({
      id: form.id,
      title: form.title,
      slug: form.slug,
      status: form.status,
      responseCount: form.responseCount,
      updatedAt: form.updatedAt,
    })
    .from(form)
    .where(eq(form.churchId, church.id))
    .orderBy(desc(form.updatedAt));

  return (
    <PageContainer>
      <PageHeader
        title="Forms"
        description="Build forms to collect registrations, feedback and more — then share a link."
      />
      <FormsList
        canManage={canManage}
        baseUrl={siteUrl()}
        forms={rows.map((r) => ({
          id: r.id,
          title: r.title,
          slug: r.slug,
          status: r.status,
          responseCount: r.responseCount,
          updatedAt: r.updatedAt.toISOString(),
        }))}
      />
    </PageContainer>
  );
}
