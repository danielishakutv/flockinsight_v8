import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Clock, Coins, Languages, MessageSquareOff } from "lucide-react";
import { SeoPage } from "@/components/landing/seo-page";
import { landingContent } from "@/lib/landing-content";
import {
  COMPARISON_TERMS,
  GEO_TERMS,
  USE_CASE_TERMS,
} from "@/lib/seo/keywords";
import {
  GEO_BASE,
  comparePath,
  countryPath,
  countrySlug,
  findCountry,
  geoContent,
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
import {
  countryProfile,
  smsAvailableForCountry,
} from "@/lib/country-profile";
import { localeInfo } from "@/lib/i18n/locales";

/**
 * A country page.
 *
 * These are the pages most at risk of being doorway pages — the same paragraph
 * with the country name swapped — so the facts panel below is built from
 * `country-profile.ts` rather than written by hand. Whatever it says about a
 * Kenyan church's currency, timezone, interface language and SMS availability
 * is what the product will actually do when that church signs up, because it
 * is read from the same table the signup form reads.
 *
 * That has a second effect worth having: the page cannot overclaim. Kenya's
 * panel says SMS is unavailable because `smsAvailableForCountry` says so, and
 * if that ever changes the page changes with it. A hand-written "SMS available
 * in your country!" would have been a lie that outlived somebody's intention.
 */

export const dynamic = "force-dynamic";

/** Prerender the set we know. An unknown country 404s. */
export function generateStaticParams() {
  return GEO_TERMS.map((t) => ({ country: countrySlug(t) }));
}

type Props = {
  params: Promise<{ country: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const { country } = await params;
  const term = findCountry(country);
  const content = term ? geoContent(term) : undefined;
  if (!term || !content) return { title: "Not found" };

  const locale = await marketingLocale(searchParams);
  const path = countryPath(term);
  /*
   * The keyword, capitalised, in the <title> — and the H1 stays a sentence.
   * A title is read by a machine and skimmed in a tab strip; the headline is
   * read by a pastor.
   */
  const title = `Church Management Software in ${term.country}`;

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

export default async function CountryPage({ params, searchParams }: Props) {
  const { country } = await params;
  const term = findCountry(country);
  const content = term ? geoContent(term) : undefined;
  if (!term || !content) notFound();

  const locale = await marketingLocale(searchParams);
  const copy = landingContent(locale);
  const path = countryPath(term);

  /*
   * Read from the same table the app uses, not retyped. See the note at the
   * top of this file: this is what stops the page promising something the
   * product will not do.
   */
  const profile = countryProfile(term.country);
  const smsAvailable = smsAvailableForCountry(term.country);
  const language = localeInfo(profile.locale);

  const facts = [
    {
      icon: Coins,
      label: "Currency",
      value: profile.currency,
      note: "Giving, expenses and every report are recorded and totalled in this currency.",
    },
    {
      icon: Clock,
      label: "Timezone",
      value: profile.tz,
      note: "Service reminders, birthday greetings and scheduled devotionals all fire on this clock.",
    },
    {
      icon: Languages,
      label: "Interface language",
      value: language?.native ?? "English",
      note: "Set at signup from your country, and changeable by every member of your team.",
    },
    {
      icon: MessageSquareOff,
      label: "Bulk SMS",
      value: smsAvailable ? "Available" : "Not yet",
      note: smsAvailable
        ? "Texts arrive from your church's own registered sender ID. Charged per message from a wallet."
        : "We have not confirmed delivery to a handset here yet, so SMS is off rather than charged for. Email to members is free and unlimited.",
    },
  ];

  const jsonLd = [
    organizationSchema(),
    pageSchema({
      path,
      name: `Church Management Software in ${term.country}`,
      description: content.summary.slice(0, 300),
    }),
    breadcrumbSchema([
      { name: "Church management software", path: GEO_BASE },
      { name: term.country, path },
    ]),
    faqSchema(content.faq, path),
  ];

  /*
   * Related links: the three nearest countries, two jobs and one comparison.
   * A generated page linked only from the footer is crawled as an orphan; a
   * cluster that links across itself reads as a section of a site.
   */
  const related = [
    ...GEO_TERMS.filter((t) => t.country !== term.country)
      .slice(0, 3)
      .map((t) => ({
        label: `Church management software in ${t.country}`,
        href: countryPath(t),
      })),
    { label: "Record attendance from your phone", href: solutionPath(USE_CASE_TERMS[0]) },
    { label: "Keep a church membership database", href: solutionPath(USE_CASE_TERMS[1]) },
    {
      label: `Compared with ${COMPARISON_TERMS[0].competitor}`,
      href: comparePath(COMPARISON_TERMS[0]),
    },
  ];

  return (
    <SeoPage
      content={content}
      eyebrow={term.country}
      crumbs={[
        { name: "Church management software", path: GEO_BASE },
        { name: term.country, path },
      ]}
      jsonLd={jsonLd}
      copy={copy}
      related={related}
    >
      {/* What is actually different about this country */}
      <section className="bg-muted/30 border-y py-16 lg:py-20">
        <div className="mx-auto max-w-4xl px-4 lg:px-8">
          <h2 className="text-2xl font-extrabold tracking-tight lg:text-3xl">
            What a church in {term.country} gets
          </h2>
          <p className="text-muted-foreground mt-3 text-pretty">
            {term.localTruth}
          </p>
          <dl className="mt-8 grid gap-4 sm:grid-cols-2">
            {facts.map((f) => (
              <div key={f.label} className="bg-card rounded-2xl border p-5">
                <div className="flex items-center gap-2.5">
                  <f.icon className="text-primary size-4 shrink-0" />
                  <dt className="text-muted-foreground text-xs font-bold tracking-wider uppercase">
                    {f.label}
                  </dt>
                </div>
                <dd className="mt-2 text-xl font-extrabold">{f.value}</dd>
                <dd className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                  {f.note}
                </dd>
              </div>
            ))}
          </dl>

          {term.incumbents?.length ? (
            <p className="text-muted-foreground mt-8 text-sm leading-relaxed">
              <span className="text-foreground font-semibold">
                Who else serves {term.country}:
              </span>{" "}
              {term.incumbents.join(", ")}. We would rather name them than
              pretend to be the only option — each is worth a look, and the
              honest comparison is on our compare pages.
            </p>
          ) : null}
        </div>
      </section>
    </SeoPage>
  );
}
