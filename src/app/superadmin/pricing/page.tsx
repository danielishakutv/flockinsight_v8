import { getPlanPrices, getStorageBundles, getAllPlanFeatures } from "@/lib/pricing";
import { getReferralRewards, platformReferralStats } from "@/lib/referrals";
import { PricingAdmin } from "@/components/superadmin/pricing-admin";

import { requirePlatform } from "@/lib/platform-access";
export const metadata = { title: "Pricing · Admin" };

export default async function SuperadminPricingPage() {
  await requirePlatform("platform.pricing.manage");
  const [prices, bundles, features, referralRewards, referralStats] =
    await Promise.all([
      getPlanPrices(),
      getStorageBundles(),
      getAllPlanFeatures(),
      getReferralRewards(),
      platformReferralStats(),
    ]);
  return (
    <PricingAdmin
      initial={{
        starter: prices.starter ?? 0,
        growth: prices.growth ?? 0,
        pro: prices.pro ?? 0,
      }}
      bundles={bundles}
      features={features}
      referralRewards={referralRewards}
      referralStats={referralStats}
    />
  );
}
