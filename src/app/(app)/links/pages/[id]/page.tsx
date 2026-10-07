import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";
import { getLinkPage, listInternalLinks } from "@/lib/link-pages";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { PlanGate } from "@/components/app/plan-gate";
import { Button } from "@/components/ui/button";
import { LinkPageEditor } from "@/components/links/link-page-editor";

export const metadata = { title: "Link page" };

/** Always current — a link added on a phone should be there on the next load. */
export const dynamic = "force-dynamic";

export default async function EditLinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { church } = await requireChurch();
  await requireCan("links.view");

  /*
   * `getLinkPage` is church-scoped, so another church's uuid pasted into this
   * URL is a 404 and not a page. The same answer for "does not exist" and "is
   * not yours" is the point.
   */
  const data = await getLinkPage(church.id, id);
  if (!data) notFound();

  const [canManage, internalLinks] = await Promise.all([
    can("links.manage"),
    listInternalLinks(church.id),
  ]);

  return (
    <PageContainer>
      <PlanGate feature="linkPages" />

      <PageHeader
        title={data.page.title}
        description="One address that holds all your links. Add your own pages from the list, pick a style, and publish."
        action={
          <Button asChild variant="outline" className="min-h-11">
            <Link href="/links">
              <ArrowLeft className="size-4" />
              All links
            </Link>
          </Button>
        }
      />

      <LinkPageEditor
        page={{
          id: data.page.id,
          slug: data.page.slug,
          title: data.page.title,
          tagline: data.page.tagline,
          status: data.page.status,
          style: data.page.style,
          layout: data.page.layout,
          showLogo: data.page.showLogo,
          showChurchName: data.page.showChurchName,
          viewCount: data.page.viewCount,
        }}
        items={data.items.map((i) => ({
          id: i.id,
          label: i.label,
          url: i.url,
          kind: i.kind,
          description: i.description,
          position: i.position,
          isActive: i.isActive,
        }))}
        internalLinks={internalLinks}
        baseUrl={siteUrl()}
        churchName={church.name}
        churchLogo={church.logo}
        churchTheme={church.theme}
        canManage={canManage}
      />
    </PageContainer>
  );
}
