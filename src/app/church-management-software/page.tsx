import type { Metadata } from "next";
import { SeoIndex, itemListSchema } from "@/components/landing/seo-index";
import { landingContent } from "@/lib/landing-content";
import { GEO_TERMS } from "@/lib/seo/keywords";
import { GEO_BASE, countryPath } from "@/lib/seo/pages";
import {
  breadcrumbSchema,
  organizationSchema,
  pageSchema,
} from "@/lib/seo/schema";
import {
  canonicalFor,
  languageAlternates,
  marketingLocale,
} from "@/lib/seo/alternates";
import { siteUrl } from "@/lib/site";

/**
 * The hub above the country pages, and the one page on the site that targets
 * the bare category term.
 *
 * We do not expect to outrank Planning Center or ChurchSuite on "church
 * management software" any time soon, and the keyword map says so in writing.
 * This page exists so there is one canonical home for the phrase rather than
 * six pages half-competing for it, and so the country pages have a parent.
 */
export const dynamic = "force-dynamic";

const TITLE = "Church Management Software, by Country";
const INTRO =
  "FlockInsight is an all-in-one church management and operations platform used by churches across Africa and Europe. Most of it is the same wherever you are — what changes is the currency your books are kept in, the clock your reminders fire on, the language your volunteers read, and whether we can deliver an SMS. Pick your country and those four answers are stated up front.";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const locale = await marketingLocale(searchParams);
  return {
    title: TITLE,
    description: INTRO.slice(0, 300),
    keywords: ["church management software", "church management system", "ChMS"],
    alternates: {
      canonical: canonicalFor(GEO_BASE, locale),
      languages: languageAlternates(GEO_BASE),
    },
    openGraph: {
      type: "website",
      url: canonicalFor(GEO_BASE, locale),
      title: TITLE,
      description: INTRO.slice(0, 300),
    },
  };
}

export default async function CountryIndexPage({ searchParams }: Props) {
  const locale = await marketingLocale(searchParams);
  const copy = landingContent(locale);

  const items = GEO_TERMS.map((t) => ({
    name: t.country,
    href: countryPath(t),
    detail: t.localTruth,
  }));

  return (
    <SeoIndex
      eyebrow="Church management software"
      title={TITLE}
      intro={INTRO}
      items={items}
      copy={copy}
      jsonLd={[
        organizationSchema(),
        pageSchema({ path: GEO_BASE, name: TITLE, description: INTRO.slice(0, 300) }),
        breadcrumbSchema([{ name: "Church management software", path: GEO_BASE }]),
        itemListSchema(GEO_BASE, siteUrl(), items),
      ]}
    />
  );
}
