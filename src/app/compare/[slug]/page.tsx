import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { SeoPage } from "@/components/landing/seo-page";
import { landingContent } from "@/lib/landing-content";
import { COMPARISON_TERMS, GEO_TERMS } from "@/lib/seo/keywords";
import {
  COMPARE_BASE,
  compareContent,
  comparePath,
  compareSlug,
  countryPath,
  findComparison,
  findSolution,
  solutionPath,
} from "@/lib/seo/pages";
import {
  breadcrumbSchema,
  faqSchema,
  organizationSchema,
  pageSchema,
} from "@/lib/seo/schema";
import {
  canonicalFor,
  languageAlternates,
  marketingLocale,
} from "@/lib/seo/alternates";

/**
 * A comparison page.
 *
 * The most commercially frightening pages on the site and the ones most likely
 * to earn it. "X alternative" is among the highest-intent phrases on the
 * internet — somebody typing it has already decided to leave — and the page
 * that answers it honestly is the one they finish reading.
 *
 * ## The "choose them" panel is the point
 *
 * It renders `chooseThemIf`: who should buy the competitor instead of us, in
 * their own terms. `pages.test.ts` requires at least two entries of real
 * length, so it cannot be quietly emptied the next time somebody wants a
 * stronger page.
 *
 * Three reasons it stays:
 *
 * - It is true. Planning Center's service planning is better than ours, Breeze
 *   is simpler, ChurchSuite has a decade of UK integrations. Saying so costs
 *   nothing we could have won anyway.
 * - It is what gets cited. A comparison that only lists its own strengths is
 *   read as a brochure by a person and discounted by a model; the trade-off is
 *   the part the asker cannot get anywhere else.
 * - A church that would have been unhappy here and buys anyway is a refund, a
 *   bad review, and a support load. Sending them away is cheaper for everyone.
 *
 * ## No comparison table of ticks and crosses
 *
 * Deliberately. A feature matrix comparing our product to somebody else's is
 * written from their marketing site, goes stale the week they ship something,
 * and is the format most likely to be unfair without anybody intending it. The
 * footnote on the landing page invites corrections for the same reason.
 */

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return COMPARISON_TERMS.map((t) => ({ slug: compareSlug(t) }));
}

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const { slug } = await params;
  const term = findComparison(slug);
  const content = term ? compareContent(term) : undefined;
  if (!term || !content) return { title: "Not found" };

  const locale = await marketingLocale(searchParams);
  const path = comparePath(term);
  const title = `${term.competitor} alternative — an honest comparison`;

  return {
    title,
    description: content.summary.slice(0, 300),
    keywords: [term.primary, ...term.variants],
    alternates: {
      canonical: canonicalFor(path, locale),
      languages: languageAlternates(path),
    },
    openGraph: {
      type: "website",
      url: canonicalFor(path, locale),
      title,
      description: content.summary.slice(0, 300),
    },
  };
}

export default async function ComparePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const term = findComparison(slug);
  const content = term ? compareContent(term) : undefined;
  if (!term || !content) notFound();

  const locale = await marketingLocale(searchParams);
  const copy = landingContent(locale);
  const path = comparePath(term);

  const jsonLd = [
    organizationSchema(),
    pageSchema({
      path,
      name: `${term.competitor} alternative`,
      description: content.summary.slice(0, 300),
    }),
    breadcrumbSchema([
      { name: "Compare", path: COMPARE_BASE },
      { name: term.competitor, path },
    ]),
    faqSchema(content.faq, path),
  ];

  // By slug, not by index into a concatenated array: an index quietly points
  // somewhere else the day a term is added above it.
  const slowConnection = findSolution("church-software-for-slow-internet");

  const related = [
    ...COMPARISON_TERMS.filter((t) => t.primary !== term.primary).map((t) => ({
      label: `${t.competitor} alternative`,
      href: comparePath(t),
    })),
    {
      label: `Church management software in ${GEO_TERMS[0].country}`,
      href: countryPath(GEO_TERMS[0]),
    },
    ...(slowConnection
      ? [
          {
            label: "Church software for a slow connection",
            href: solutionPath(slowConnection),
          },
        ]
      : []),
  ];

  return (
    <SeoPage
      content={content}
      eyebrow={`Compared with ${term.competitor}`}
      crumbs={[
        { name: "Compare", path: COMPARE_BASE },
        { name: term.competitor, path },
      ]}
      jsonLd={jsonLd}
      copy={copy}
      related={related}
    >
      {/* The two-sided recommendation */}
      <section className="bg-muted/30 border-y py-16 lg:py-20">
        <div className="mx-auto max-w-4xl px-4 lg:px-8">
          <h2 className="text-2xl font-extrabold tracking-tight lg:text-3xl">
            Which of us you should actually pick
          </h2>
          <p className="text-muted-foreground mt-3 text-pretty">
            Written by us, so read it with that in mind — but we have tried to
            be the kind of comparison we would want to find.
          </p>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {/*
              `chooseThemIf` comes first on purpose. Putting our own case first
              makes the honest column read as a concession tacked on the end;
              putting theirs first is what makes the page trustworthy enough to
              be worth reading at all.
            */}
            <div className="bg-card rounded-2xl border p-6">
              <div className="flex items-center gap-2.5">
                <span className="bg-muted text-muted-foreground grid size-9 place-items-center rounded-xl">
                  <ThumbsDown aria-hidden className="size-4" />
                </span>
                <h3 className="font-extrabold">
                  Choose {term.competitor} if…
                </h3>
              </div>
              <ul className="mt-4 space-y-3">
                {content.chooseThemIf.map((line) => (
                  <li
                    key={line}
                    className="text-muted-foreground flex gap-2.5 text-sm leading-relaxed"
                  >
                    <span aria-hidden className="text-muted-foreground mt-0.5">
                      •
                    </span>
                    <span className="text-pretty">{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-card border-primary/40 ring-primary/10 rounded-2xl border p-6 ring-2">
              <div className="flex items-center gap-2.5">
                <span className="bg-primary/10 text-primary grid size-9 place-items-center rounded-xl">
                  <ThumbsUp aria-hidden className="size-4" />
                </span>
                <h3 className="font-extrabold">Choose FlockInsight if…</h3>
              </div>
              <ul className="mt-4 space-y-3">
                {content.chooseUsIf.map((line) => (
                  <li key={line} className="flex gap-2.5 text-sm leading-relaxed">
                    <span aria-hidden className="text-primary mt-0.5">•</span>
                    <span className="text-pretty">{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* The one-line summary of each side, from the keyword map. */}
          <dl className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="bg-card rounded-2xl border p-5">
              <dt className="text-primary text-xs font-bold tracking-wider uppercase">
                Where FlockInsight is stronger
              </dt>
              <dd className="mt-2 text-sm leading-relaxed text-pretty">
                {term.ourEdge}
              </dd>
            </div>
            <div className="bg-card rounded-2xl border p-5">
              <dt className="text-muted-foreground text-xs font-bold tracking-wider uppercase">
                Where {term.competitor} is stronger
              </dt>
              <dd className="mt-2 text-sm leading-relaxed text-pretty">
                {term.honestWeakness}
              </dd>
            </div>
          </dl>

          <p className="text-muted-foreground mt-6 text-xs">
            {term.competitor} is not affiliated with FlockInsight, and nothing
            here is quoted from them. If anything on this page is out of date,
            email support@flockinsight.com and we will correct it.
          </p>
        </div>
      </section>
    </SeoPage>
  );
}
