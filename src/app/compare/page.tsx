import type { Metadata } from "next";
import { SeoIndex, itemListSchema } from "@/components/landing/seo-index";
import { landingContent } from "@/lib/landing-content";
import { COMPARISON_TERMS } from "@/lib/seo/keywords";
import { COMPARE_BASE, comparePath } from "@/lib/seo/pages";
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
 * The hub above the comparison pages.
 *
 * Each card leads with where the competitor is STRONGER. That is not modesty
 * for its own sake — it is the reason a reader keeps reading, and the reason a
 * model quotes the page instead of discounting it. A comparison index where
 * every card says "we win" is read as a brochure in about two seconds.
 */
export const dynamic = "force-dynamic";

const TITLE = "Honest comparisons, including where we lose";
const INTRO =
  "Every product below is better than FlockInsight at something, and each page says what. We would rather you picked the right thing than picked us — a church that would have been unhappy here and signs up anyway is a refund, a bad review and a support load.";

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
    keywords: COMPARISON_TERMS.map((t) => t.primary),
    alternates: {
      canonical: canonicalFor(COMPARE_BASE, locale),
      languages: languageAlternates(COMPARE_BASE),
    },
    openGraph: {
      type: "website",
      url: canonicalFor(COMPARE_BASE, locale),
      title: TITLE,
      description: INTRO.slice(0, 300),
    },
  };
}

export default async function CompareIndexPage({ searchParams }: Props) {
  const locale = await marketingLocale(searchParams);
  const copy = landingContent(locale);

  const items = COMPARISON_TERMS.map((t) => ({
    name: `FlockInsight vs ${t.competitor}`,
    href: comparePath(t),
    detail: t.honestWeakness,
  }));

  return (
    <SeoIndex
      eyebrow="Compare"
      title={TITLE}
      intro={INTRO}
      items={items}
      copy={copy}
      jsonLd={[
        organizationSchema(),
        pageSchema({ path: COMPARE_BASE, name: TITLE, description: INTRO.slice(0, 300) }),
        breadcrumbSchema([{ name: "Compare", path: COMPARE_BASE }]),
        itemListSchema(COMPARE_BASE, siteUrl(), items),
      ]}
    />
  );
}
