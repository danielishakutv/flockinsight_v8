import { getPlanPrices, getStorageBundles, getAllPlanFeatures } from "@/lib/pricing";
import { PricingAdmin } from "@/components/superadmin/pricing-admin";

export const metadata = { title: "Pricing · Admin" };

export default async function SuperadminPricingPage() {
  const [prices, bundles, features] = await Promise.all([
    getPlanPrices(),
    getStorageBundles(),
    getAllPlanFeatures(),
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
    />
  );
}
