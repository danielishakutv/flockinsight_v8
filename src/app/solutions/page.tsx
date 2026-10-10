import type { Metadata } from "next";
import { SeoIndex, itemListSchema } from "@/components/landing/seo-index";
import { landingContent } from "@/lib/landing-content";
import {
  SOLUTION_BASE,
  SOLUTION_TERMS,
  solutionContent,
  solutionPath,
} from "@/lib/seo/pages";
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
 * The hub above the solution pages.
 *
 * The `detail` on each card is the first sentence of that page's own summary,
 * so the index can never describe a page differently from how the page
 * describes itself — which is the usual way a hub page goes stale.
 */
export const dynamic = "force-dynamic";

const TITLE = "What do you need it to do?";
const INTRO =
  "Most people arrive knowing the one job they need solved — count the congregation, keep the member list current, chase first-timers, text everyone, keep the books. Each of these answers one of those completely, and says which modules do the work.";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const locale = await marketingLocale(searchParams);
  return {
    title: "Church software solutions, by job",
    description: INTRO.slice(0, 300),
    keywords: SOLUTION_TERMS.map((t) => t.primary),
    alternates: {
      canonical: canonicalFor(SOLUTION_BASE, locale),
      languages: languageAlternates(SOLUTION_BASE),
    },
    openGraph: {
      type: "website",
      url: canonicalFor(SOLUTION_BASE, locale),
      title: "Church software solutions, by job",
      description: INTRO.slice(0, 300),
    },
  };
}

export default async function SolutionIndexPage({ searchParams }: Props) {
  const locale = await marketingLocale(searchParams);
  const copy = landingContent(locale);

  const items = SOLUTION_TERMS.map((t) => {
    const content = solutionContent(t);
    return {
      name: content?.h1 ?? t.primary,
      href: solutionPath(t),
      // The page's own first sentence, so the two cannot disagree.
      detail: content ? `${content.summary.split(". ")[0]}.` : t.question,
    };
  });

  return (
    <SeoIndex
      eyebrow="Solutions"
      title={TITLE}
      intro={INTRO}
      items={items}
      copy={copy}
      jsonLd={[
        organizationSchema(),
        pageSchema({
          path: SOLUTION_BASE,
          name: "Church software solutions, by job",
          description: INTRO.slice(0, 300),
        }),
        breadcrumbSchema([{ name: "Solutions", path: SOLUTION_BASE }]),
        itemListSchema(SOLUTION_BASE, siteUrl(), items),
      ]}
    />
  );
}
