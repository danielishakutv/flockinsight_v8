import { redirect } from "next/navigation";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getPlanPrice } from "@/lib/pricing";
import { ProfileForm } from "@/components/settings/profile-form";

export const metadata = { title: "Settings" };

function priceLabel(price: number | null): string {
  if (price === null) return "Custom";
  if (price === 0) return "Free";
  return `₦${price.toLocaleString()}/mo`;
}

export default async function GeneralSettingsPage() {
  const { church } = await requireChurch();
  if (!(await can("settings.manage"))) {
    // Team-only managers land on the Team tab instead.
    redirect((await can("team.manage")) ? "/settings/team" : "/dashboard");
  }
  const planPrice = await getPlanPrice(church.plan);
  return (
    <ProfileForm
      initialName={church.name}
      initialTimezone={church.timezone}
      initialCurrency={church.currency}
      initialCountry={church.country}
      initialState={church.state}
      plan={church.plan}
      planPriceLabel={priceLabel(planPrice)}
    />
  );
}
