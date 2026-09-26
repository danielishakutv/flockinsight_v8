import Link from "next/link";
import { Settings2 } from "lucide-react";
import { requireChurch } from "@/lib/session";
import { requireCan, can } from "@/lib/permissions";
import { getUpcomingCelebrations } from "@/lib/celebrations";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { CelebrationsDirectory } from "@/components/celebrations/celebrations-directory";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Celebrations" };

const WINDOW_DAYS = 90;

export default async function CelebrationsPage() {
  const { church } = await requireChurch();
  const t = await getT();
  await requireCan("members.view");
  const canSettings = await can("settings.manage");

  const items = await getUpcomingCelebrations(church.id, WINDOW_DAYS);

  return (
    <PageContainer>
      <PageHeader
        title={t("celebrations.title")}
        description={t("celebrations.subtitle")}
        action={
          canSettings ? (
            <Button variant="outline" asChild>
              <Link href="/settings/celebrations">
                <Settings2 className="size-4" /> Auto-messages
              </Link>
            </Button>
          ) : undefined
        }
      />
      <CelebrationsDirectory items={items} days={WINDOW_DAYS} />
    </PageContainer>
  );
}
