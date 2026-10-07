import { redirect } from "next/navigation";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getPlanPrice } from "@/lib/pricing";
import { planPriceLabelFor, priceForCountry } from "@/lib/plan-price";
import { ProfileForm } from "@/components/settings/profile-form";
import { AboutSoftware } from "@/components/settings/about-software";
import { ShortcutTipsSettings } from "@/components/settings/shortcut-tips-settings";

export const metadata = { title: "Settings" };

export default async function GeneralSettingsPage() {
  const { church } = await requireChurch();
  if (!(await can("settings.manage"))) {
    // Team-only managers land on the Team tab instead.
    redirect((await can("team.manage")) ? "/settings/team" : "/dashboard");
  }
  const basePrice = await getPlanPrice(church.plan);
  /*
   * Quoted in the church's own money, including the international card fee,
   * so this agrees with the Billing tab and with what the card is charged.
   * A naira figure here and meticais there is how a church starts doubting
   * both.
   */
  const planPrice =
    basePrice === null
      ? "Custom"
      : planPriceLabelFor(await priceForCountry(basePrice, church.country));
  return (
    <div className="space-y-6">
      <ProfileForm
        initialName={church.name}
        initialTimezone={church.timezone}
        initialCurrency={church.currency}
        initialCountry={church.country}
        initialState={church.state}
        plan={church.plan}
        planPriceLabel={planPrice}
      />
      {/* Per-browser, so it sits here rather than in the church profile. */}
      <ShortcutTipsSettings />
      <AboutSoftware churchName={church.name} />
    </div>
  );
}
