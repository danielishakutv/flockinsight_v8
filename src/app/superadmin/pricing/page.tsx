import { getPlanPrices } from "@/lib/pricing";
import { PricingAdmin } from "@/components/superadmin/pricing-admin";

export const metadata = { title: "Pricing · Admin" };

export default async function SuperadminPricingPage() {
  const prices = await getPlanPrices();
  return (
    <PricingAdmin
      initial={{
        starter: prices.starter ?? 0,
        growth: prices.growth ?? 0,
        pro: prices.pro ?? 0,
      }}
    />
  );
}
