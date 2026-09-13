import { getUsageOverview } from "@/lib/analytics";
import { UsageDashboard } from "@/components/superadmin/usage-dashboard";

import { requirePlatform } from "@/lib/platform-access";
export const metadata = { title: "Usage · Admin" };
export const dynamic = "force-dynamic";

export default async function SuperadminUsagePage() {
  await requirePlatform("platform.overview.view");
  const overview = await getUsageOverview();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Usage</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          How churches use FlockInsight — active users, feature adoption and
          trends. For funnels, paths, retention &amp; session replay, see PostHog.
        </p>
      </div>
      <UsageDashboard overview={overview} />
    </div>
  );
}
