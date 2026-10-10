import { countryProfile, smsAvailableForCountry } from "@/lib/country-profile";
import { findCountry } from "@/lib/seo/pages";
import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";

/**
 * A country page's link preview.
 *
 * The chips carry the three facts that are actually different per country —
 * currency, timezone, whether SMS delivers — read from `country-profile.ts`
 * rather than written here. A card that promised SMS where we cannot deliver it
 * would be the worst possible place for that claim to live, because a preview
 * is forwarded further than the page it came from.
 */
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Church management software, by country";
export const revalidate = 86_400;

export default async function Image({
  params,
}: {
  params: Promise<{ country: string }>;
}) {
  const { country } = await params;
  const term = findCountry(country);

  if (!term) {
    return ogCard({
      eyebrow: "Church management software",
      title: "Pick your country",
      subtitle:
        "Your currency, your timezone, your language — stated up front rather than discovered later.",
    });
  }

  const profile = countryProfile(term.country);
  return ogCard({
    eyebrow: `Church software · ${term.country}`,
    title: `Church management software in ${term.country}`,
    subtitle: term.localTruth,
    chips: [
      profile.currency,
      profile.tz,
      smsAvailableForCountry(term.country) ? "SMS available" : "Email, free",
    ],
  });
}
