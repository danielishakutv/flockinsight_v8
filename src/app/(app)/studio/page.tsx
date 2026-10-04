import Link from "next/link";
import { BookOpen } from "lucide-react";
import { requireChurch } from "@/lib/session";
import { getT } from "@/lib/i18n/server";
import { can, requireCan } from "@/lib/permissions";
import { listPresets } from "@/lib/image-presets";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { StudioClient } from "@/components/studio/studio-client";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Photo studio" };

/**
 * Branding the church's photographs.
 *
 * The page is almost empty on purpose: it reads the church's saved presets and
 * hands them to a client component, because every pixel of the actual work
 * happens in the browser. There is no upload, no queue, no job, and no server
 * CPU — see the comment at the top of lib/image-studio.ts for why that is the
 * only responsible way to do this on one shared VPS.
 */
export default async function StudioPage() {
  const { church } = await requireChurch();
  const t = await getT();
  await requireCan("media.view");
  const canManagePresets = await can("media.manage");

  const presets = await listPresets(church.id);

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        title={t("studio.title")}
        description={t("studio.subtitle")}
        action={
          <Button asChild variant="outline">
            <Link href="/help/photo-studio">
              <BookOpen className="size-4" />
              {t("studio.howToUse")}
            </Link>
          </Button>
        }
      />
      <StudioClient
        churchName={church.name}
        churchLogoUrl={church.logo}
        presets={presets.map((p) => ({
          id: p.id,
          name: p.name,
          logoUrl: p.logoUrl,
          logoMediaId: p.logoMediaId,
          isDefault: p.isDefault,
          config: p.config,
        }))}
        canManagePresets={canManagePresets}
      />
    </PageContainer>
  );
}
