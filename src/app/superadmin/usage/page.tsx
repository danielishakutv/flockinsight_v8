import { getUsageOverview } from "@/lib/analytics";
import { UsageDashboard } from "@/components/superadmin/usage-dashboard";

export const metadata = { title: "Usage · Admin" };
export const dynamic = "force-dynamic";

export default async function SuperadminUsagePage() {
  const overview = await getUsageOverview();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">Usage</h1>
        <p className="text-muted-foreground mt-1">
          How churches use FlockInsight — active users, feature adoption and
          trends. For funnels, paths, retention &amp; session replay, see PostHog.
        </p>
      </div>
      <UsageDashboard overview={overview} />
    </div>
  );
}
