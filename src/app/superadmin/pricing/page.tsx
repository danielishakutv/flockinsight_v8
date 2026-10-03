import {
  allPlanCopyOverridden,
  allPlanFeatureDrift,
  getAllPlanEmails,
  getAllPlanFeatures,
  getAllPlanStorageMb,
  getPlanPrices,
  getStorageBundles,
} from "@/lib/pricing";
import { getReferralRewards, platformReferralStats } from "@/lib/referrals";
import { PricingAdmin } from "@/components/superadmin/pricing-admin";
import { PlanAllowances } from "@/components/superadmin/plan-allowances";

import { requirePlatform } from "@/lib/platform-access";
export const metadata = { title: "Pricing · Admin" };

export default async function SuperadminPricingPage() {
  await requirePlatform("platform.pricing.manage");
  const [
    prices,
    bundles,
    features,
    storageMb,
    emails,
    overridden,
    drift,
    referralRewards,
    referralStats,
  ] =
    await Promise.all([
      getPlanPrices(),
      getStorageBundles(),
      getAllPlanFeatures(),
      getAllPlanStorageMb(),
      getAllPlanEmails(),
      allPlanCopyOverridden(),
      allPlanFeatureDrift(),
      getReferralRewards(),
      platformReferralStats(),
    ]);
  return (
    <div className="space-y-6">
      <PricingAdmin
        initial={{
          starter: prices.starter ?? 0,
          growth: prices.growth ?? 0,
          pro: prices.pro ?? 0,
        }}
        bundles={bundles}
        features={features}
        drift={drift}
        referralRewards={referralRewards}
        referralStats={referralStats}
      />
      <PlanAllowances
        storageMb={storageMb}
        emails={emails}
        overridden={overridden}
      />
    </div>
  );
}
