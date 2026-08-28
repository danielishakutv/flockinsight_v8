import { redirect } from "next/navigation";
import { requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { allowedDatasets } from "@/lib/report-catalog";
import { getDatasetCounts } from "@/lib/report-data";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { ReportsBrowser } from "@/components/reports/reports-browser";

export const metadata = { title: "Reports & data" };

export default async function ReportsPage() {
  const { church } = await requireChurch();

  // The list is built from what this person may actually see, so nothing is
  // offered that the download route will then refuse.
  const access = await getAccess();
  const datasets = allowedDatasets([...access.perms], access.isOwner);
  if (datasets.length === 0) redirect("/dashboard");

  const counts = await getDatasetCounts(church.id);

  return (
    <PageContainer>
      <PageHeader
        title="Reports & data"
        description="Download any part of your church's data as a spreadsheet or a PDF — or take the whole thing in one file for analysis."
      />
      <ReportsBrowser datasets={datasets} counts={counts} />
    </PageContainer>
  );
}
