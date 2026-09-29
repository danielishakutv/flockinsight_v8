import { Suspense } from "react";
import { requirePlatform } from "@/lib/platform-access";
import { getUsageOverview } from "@/lib/analytics";
import {
  getCohortInsight,
  getDemographyInsight,
  getEconomicsInsight,
} from "@/lib/insights";
import {
  AdoptionPanel,
  CohortPanel,
  DemographyPanel,
  EconomicsPanel,
} from "@/components/superadmin/insight-panels";
import { ListCardSkeleton } from "@/components/superadmin/skeletons";

export const metadata = { title: "Insights · Admin" };
export const dynamic = "force-dynamic";

/**
 * The analytics suite, kept off the command centre on purpose.
 *
 * The dashboard's job is "is anything wrong?", answered above the fold on a
 * phone. Cohort tables and unit economics are the opposite kind of question —
 * asked deliberately, read slowly — and putting them there would have meant a
 * page with a dozen queries and the same numbers rendered twice.
 *
 * Every panel here states its sample. Several will say they cannot be read yet.
 * That is the honest answer at fourteen churches, and it is more useful than a
 * confident one.
 */
export default async function InsightsPage() {
  await requirePlatform("platform.overview.view");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Insights</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What the numbers can and cannot tell you yet. Each panel says what it
          rests on.
        </p>
      </div>

      <Suspense fallback={<ListCardSkeleton rows={4} />}>
        <Adoption />
      </Suspense>

      <Suspense fallback={<ListCardSkeleton rows={4} />}>
        <Cohorts />
      </Suspense>

      <Suspense fallback={<ListCardSkeleton rows={3} />}>
        <Economics />
      </Suspense>

      <Suspense fallback={<ListCardSkeleton rows={5} />}>
        <Demography />
      </Suspense>
    </div>
  );
}

async function Adoption() {
  return <AdoptionPanel overview={await getUsageOverview()} />;
}

async function Cohorts() {
  return <CohortPanel data={await getCohortInsight()} />;
}

async function Economics() {
  return <EconomicsPanel data={await getEconomicsInsight()} />;
}

async function Demography() {
  return <DemographyPanel data={await getDemographyInsight()} />;
}
