import { requireChurch } from "@/lib/session";
import { ProfileForm } from "@/components/settings/profile-form";

export const metadata = { title: "Settings" };

export default async function GeneralSettingsPage() {
  const { church } = await requireChurch();
  return (
    <ProfileForm
      initialName={church.name}
      initialTimezone={church.timezone}
      initialCurrency={church.currency}
    />
  );
}
