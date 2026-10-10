import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeoPage } from "@/components/landing/seo-page";
import { FEATURES, landingContent } from "@/lib/landing-content";
import { COMPARISON_TERMS, GEO_TERMS } from "@/lib/seo/keywords";
import {
  SOLUTION_BASE,
  SOLUTION_TERMS,
  comparePath,
  countryPath,
  findSolution,
  solutionContent,
  solutionPath,
  solutionSlug,
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
 * A solution page: one job, answered completely.
 *
 * The buyer arriving here already knows what they need — they typed "church
 * attendance app", not "church software" — so the page's job is not to sell the
 * platform. It answers that one question, shows the modules that actually back
 * it, and mentions the rest once at the bottom.
 *
 * The "backed by" panel is generated from the term's `backedBy` list against
 * the real FEATURES array, which means a page cannot claim a capability the
 * product does not ship. `keywords.test.ts` already refuses a term with an
 * empty `backedBy`; this is the other half of that guarantee, on the page
 * itself.
 */

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return SOLUTION_TERMS.map((t) => ({ slug: solutionSlug(t) }));
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
  const term = findSolution(slug);
  const content = term ? solutionContent(term) : undefined;
  if (!term || !content) return { title: "Not found" };

  const locale = await marketingLocale(searchParams);
  const path = solutionPath(term);
  /*
   * Title-cased keyword plus a benefit clause. The keyword alone reads as a
   * directory listing; the clause is what makes it a result somebody clicks.
   */
  const title = `${sentence(term.primary)} — FlockInsight`;

  return {
    title: sentence(term.primary),
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

function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default async function SolutionPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const term = findSolution(slug);
  const content = term ? solutionContent(term) : undefined;
  if (!term || !content) notFound();

  const locale = await marketingLocale(searchParams);
  const copy = landingContent(locale);
  const path = solutionPath(term);

  /*
   * The modules behind the claim, taken from the localised FEATURES so the
   * panel translates with the page. An icon key with no matching feature is
   * dropped rather than rendered empty — the same defensive line as in the
   * module explorer, for the same reason.
   */
  const backing = term.backedBy
    .map((icon) => copy.features.find((f) => f.icon === icon))
    .filter((f): f is (typeof FEATURES)[number] => Boolean(f));

  const jsonLd = [
    organizationSchema(),
    pageSchema({
      path,
      name: sentence(term.primary),
      description: content.summary.slice(0, 300),
    }),
    breadcrumbSchema([
      { name: "Solutions", path: SOLUTION_BASE },
      { name: sentence(term.primary), path },
    ]),
    faqSchema(content.faq, path),
  ];

  const related = [
    ...SOLUTION_TERMS.filter((t) => t.primary !== term.primary)
      .slice(0, 4)
      .map((t) => ({ label: sentence(t.primary), href: solutionPath(t) })),
    {
      label: `Church management software in ${GEO_TERMS[0].country}`,
      href: countryPath(GEO_TERMS[0]),
    },
    {
      label: `Compared with ${COMPARISON_TERMS[0].competitor}`,
      href: comparePath(COMPARISON_TERMS[0]),
    },
  ];

  return (
    <SeoPage
      content={content}
      eyebrow={sentence(term.primary)}
      crumbs={[
        { name: "Solutions", path: SOLUTION_BASE },
        { name: sentence(term.primary), path },
      ]}
      jsonLd={jsonLd}
      copy={copy}
      related={related}
    >
      {backing.length ? (
        <section className="bg-muted/30 border-y py-16 lg:py-20">
          <div className="mx-auto max-w-4xl px-4 lg:px-8">
            <h2 className="text-2xl font-extrabold tracking-tight lg:text-3xl">
              The modules behind this
            </h2>
            <p className="text-muted-foreground mt-3 text-pretty">
              Not a feature list written for this page — these are the parts of
              the product that do the work, and they are included on a paid plan
              rather than priced separately.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {backing.map((f) => (
                <div key={f.title} className="bg-card rounded-2xl border p-5">
                  <h3 className="font-bold">{f.title}</h3>
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed text-pretty">
                    {f.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </SeoPage>
  );
}
