import { redirect } from "next/navigation";
import { requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { allowedDatasets } from "@/lib/report-catalog";
import { getDatasetCounts } from "@/lib/report-data";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { ReportsBrowser } from "@/components/reports/reports-browser";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Reports & data" };

export default async function ReportsPage() {
  const { church } = await requireChurch();
  const t = await getT();

  // The list is built from what this person may actually see, so nothing is
  // offered that the download route will then refuse.
  const access = await getAccess();
  const datasets = allowedDatasets([...access.perms], access.isOwner);
  if (datasets.length === 0) redirect("/dashboard");

  const counts = await getDatasetCounts(church.id);

  return (
    <PageContainer>
      <PageHeader
        title={t("reports.title")}
        description={t("reports.subtitle")}
      />
      <ReportsBrowser datasets={datasets} counts={counts} />
    </PageContainer>
  );
}
