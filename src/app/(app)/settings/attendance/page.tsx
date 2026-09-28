import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { BAND_SEEDS, bandsFor, oldestFirst } from "@/lib/attendance-bands";
import { AttendanceBandsForm } from "@/components/settings/attendance-bands-form";

export const metadata = { title: "Attendance · Settings" };
export const dynamic = "force-dynamic";

export default async function AttendanceSettingsPage() {
  const { church } = await requireChurch();
  await requireCan("settings.manage");

  // Oldest first, matching the recording form — somebody who turns a band on
  // here and goes straight to a sheet should not have to re-read the list in
  // the opposite direction.
  const bands = oldestFirst(bandsFor(church.attendanceBands));

  return (
    <PageContainer className="max-w-2xl">
      <PageHeader
        title="Who you count"
        description="Choose the groups your church counts on a Sunday, and what you call them."
      />
      <AttendanceBandsForm
        bands={bands.map((b) => ({
          key: b.key,
          label: b.label,
          enabled: b.enabled,
          hint: BAND_SEEDS.find((s) => s.key === b.key)?.hint ?? "",
          /*
           * Adults is fixed on. Every attendance sheet ever recorded here put
           * its adults in that column, so a church that hid the band would be
           * reading years of its own history with the largest number missing.
           */
          locked: b.key === "adults",
        }))}
      />
    </PageContainer>
  );
}
