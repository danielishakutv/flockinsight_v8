import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { form } from "@/db/schema";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { requireChurch } from "@/lib/session";
import { requireCan, getAccess } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";
import { ensureSignup, signupUrl } from "@/lib/member-signup";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { FormsList } from "@/components/forms/forms-list";
import { MemberSignupLink } from "@/components/members/member-signup-link";

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

  const signup = canManage
    ? await ensureSignup({ id: church.id, name: church.name, handle: church.handle })
    : null;

  return (
    <PageContainer>
      <PageHeader
        title="Forms"
        description="Build forms to collect registrations, feedback and more — then share a link."
      />

      {signup && (
        <div className="border-primary/30 from-primary/5 mb-6 flex flex-col gap-4 rounded-2xl border bg-gradient-to-br to-transparent p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="bg-primary/10 text-primary grid size-11 shrink-0 place-items-center rounded-xl">
              <UserPlus className="size-5" />
            </div>
            <div>
              <p className="font-bold">Member self-registration</p>
              <p className="text-muted-foreground text-sm">
                A ready-made public link where people add themselves to your
                church — with duplicate detection and group selection built in.{" "}
                <Link href="/settings/signup" className="text-primary font-medium underline">
                  Customise it
                </Link>
                .
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <MemberSignupLink url={signupUrl(signup.slug)} enabled={signup.enabled} />
          </div>
        </div>
      )}

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
