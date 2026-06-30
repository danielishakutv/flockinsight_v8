import { redirect } from "next/navigation";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";
import { PublicProfileForm } from "@/components/settings/public-profile-form";

export const metadata = { title: "Public page · Settings" };

export default async function PublicProfileSettingsPage() {
  const { church } = await requireChurch();
  if (!(await can("settings.manage"))) {
    redirect((await can("team.manage")) ? "/settings/team" : "/dashboard");
  }

  return (
    <PublicProfileForm
      baseUrl={siteUrl()}
      initial={{
        handle: church.handle ?? church.slug,
        publicEnabled: church.publicEnabled,
        theme: church.theme ?? "indigo",
        name: church.name,
        denomination: church.denomination ?? "",
        tagline: church.tagline ?? "",
        about: church.about ?? "",
        logo: church.logo ?? null,
        coverUrl: church.coverUrl ?? null,
        photos: church.photos ?? [],
        addressText: church.addressText ?? "",
        landmarks: church.landmarks ?? "",
        city: church.city ?? "",
        state: church.state ?? "",
        country: church.country ?? "",
        lat: church.lat,
        lng: church.lng,
        publicPhone: church.publicPhone ?? "",
        publicEmail: church.publicEmail ?? "",
        website: church.website ?? "",
        socials: church.socials ?? {},
      }}
    />
  );
}
