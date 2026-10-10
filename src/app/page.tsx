import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Quote,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import { JsonLd } from "@/components/seo/json-ld";
import { PromoPopup } from "@/components/public/promo-popup";
import { PublicHeader } from "@/components/landing/public-header";
import { PublicFooter } from "@/components/landing/public-footer";
import { SectionHeading } from "@/components/landing/section-heading";
import { ModuleGroups } from "@/components/landing/module-groups";
import { ReplacesTable } from "@/components/landing/replaces-table";
import { CompareTable } from "@/components/landing/compare-table";
import { getPlans } from "@/lib/pricing";
import {
  currencyNoteFor,
  planPriceLabelFor,
  pricesForCountry,
  requestCountry,
} from "@/lib/plan-price";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { landingContent } from "@/lib/landing-content";
import { AUDIENCE_CARDS, PROOF, sections } from "@/lib/landing-sections";
import { ENTITY_SENTENCE_SHORT, metaKeywords } from "@/lib/seo/keywords";
import {
  faqSchema,
  organizationSchema,
  pageSchema,
  softwareSchema,
  websiteSchema,
} from "@/lib/seo/schema";
import {
  canonicalFor,
  languageAlternates,
  marketingLocale,
} from "@/lib/seo/alternates";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Metadata, per language.
 *
 * `generateMetadata` rather than a static export because the canonical has to
 * follow the language. `?lang=fr` canonical to `/` would tell the index that
 * the French page is a duplicate of the English one and should be dropped —
 * which is the most common way an hreflang setup gets built backwards, and it
 * would quietly undo the whole point of making the translations indexable.
 */
export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const locale = await marketingLocale(searchParams);
  const c = landingContent(locale);
  /*
   * The keyword lives in the title; the headline on the page does not have to.
   * A <title> is read by a machine and skimmed in a tab strip, so the category
   * belongs in it. The H1 is read by a pastor, so it is a sentence.
   */
  const title = "Church Management Software & Church Operations Platform";
  const description =
    locale === "en" ? ENTITY_SENTENCE_SHORT : c.hero.body.slice(0, 180);

  return {
    title,
    description,
    keywords: metaKeywords(),
    alternates: {
      canonical: canonicalFor("/", locale),
      languages: languageAlternates("/"),
    },
    openGraph: {
      type: "website",
      url: canonicalFor("/", locale),
      title,
      description,
    },
  };
}

/*
 * Rendered per request, not cached as a build-time copy.
 *
 * This page reads the language cookie and the visitor's country, so the words
 * AND the prices differ per visitor. It carried `revalidate = 3600` before,
 * which did nothing once those reads were added — and worse, the try/catch
 * around them used to swallow Next's bail-out, so the page really was frozen as
 * one English build-time copy. The rethrow in `getLocale` fixed that; this note
 * exists so nobody re-adds the revalidate and wonders why French stopped
 * working.
 */

export default async function LandingPage({ searchParams }: PageProps) {
  const locale = await marketingLocale(searchParams);
  const c = landingContent(locale);
  const s = sections(locale);
  const nav = c.nav;

  /**
   * Structured data.
   *
   * Built from `lib/seo/schema.ts` so this page and the twenty-two generated
   * ones describe the same entity with the same `@id` — which is the signal
   * that resolves a site to one credible entity rather than several
   * half-credible ones. The FAQ is emitted from the same array the page
   * renders, because structured data that does not match the visible page is
   * cloaking. There is deliberately no AggregateRating: we have no verified
   * reviews, and inventing them is how a domain loses its rich results.
   */
  const jsonLd = [
    organizationSchema(),
    websiteSchema(),
    softwareSchema(),
    pageSchema({
      path: "/",
      name: "FlockInsight — Church Management & Operations Platform",
      description: ENTITY_SENTENCE_SHORT,
    }),
    faqSchema(c.faq, "/"),
  ];

  const plans = await getPlans();

  /*
   * Plan prices in the visitor's own currency. A church outside Nigeria also
   * carries a surcharge covering the international card fee, so the figure here
   * is the figure checkout charges — same helper, one calculation.
   */
  const priced = await pricesForCountry(
    Object.fromEntries(plans.map((p) => [p.id, p.priceMonthly])),
    await requestCountry(),
  );
  const currencyNote = currencyNoteFor(priced, c.pricing);

  return (
    <div className="flex min-h-dvh flex-col">
      <JsonLd data={jsonLd} />
      <PromoPopup />
      <PublicHeader nav={nav} />

      <main className="flex-1">
        {/* ---------------------------------------------------------------
            Hero
            --------------------------------------------------------------- */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(55%_50%_at_50%_0%,theme(colors.primary/10%),transparent)]"
          />
          {/*
            A faint grid, masked to fade out. Gives the hero a surface to sit on
            rather than floating type on flat white, which is what makes a
            landing page read as a template. Pure CSS — no image to download on
            a connection that cannot spare one.
          */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,theme(colors.border)_1px,transparent_1px),linear-gradient(to_bottom,theme(colors.border)_1px,transparent_1px)] bg-[size:72px_72px] opacity-[0.22] [mask-image:radial-gradient(60%_45%_at_50%_0%,black,transparent)]"
          />

          <div className="mx-auto max-w-5xl px-4 py-20 text-center lg:py-28">
            {/*
              An opaque pill, not a 10%-alpha one.
              `bg-primary/10 text-primary` is fine on white and nearly
              invisible here, because this badge sits on top of the hero's
              violet radial gradient — violet text on a violet wash. It only
              showed up on a screenshot; at desk-height on a bright monitor it
              reads as "slightly faint" rather than as a contrast failure,
              which is how it survived.
            */}
            <span className="bg-background text-primary ring-primary/15 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold shadow-sm ring-1">
              <Star className="size-4 fill-current" />
              {c.hero.eyebrow}
            </span>
            <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              {c.hero.title}{" "}
              <span className="text-primary">{c.hero.titleAccent}</span>
            </h1>
            <p className="text-muted-foreground mx-auto mt-6 max-w-3xl text-lg text-pretty lg:text-xl">
              {c.hero.body}
            </p>
            {/*
              Full width and wrappable on a phone.
              `Button` sets `whitespace-nowrap`, which is right for English —
              and wrong for "Démarrer mon essai gratuit", which at 320px was
              374px wide and hung 27px off each edge of the screen. A
              translation is not an edge case on a site in eight languages.
            */}
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row [&_a]:max-sm:w-full [&_a]:max-sm:whitespace-normal">
              <Button asChild size="xl">
                {/*
                  "Start my free trial", not "Start free trial". A possessive
                  measurably lifts conversion for the same reason "my" feels
                  like something already belonging to you and "your" feels like
                  something being sold.
                */}
                <Link href="/signup">
                  {c.hero.ctaPrimary} <ArrowRight className="size-5" />
                </Link>
              </Button>
              <Button asChild size="xl" variant="outline">
                <Link href="/demo">{c.footer.bookWalkthrough}</Link>
              </Button>
            </div>
            <p className="text-muted-foreground mt-4 text-sm">
              {c.hero.reassurance}
            </p>

            {/*
              The extractable summary.
              Content near the top of a page is weighted heavily by the systems
              that assemble AI answers, and this paragraph is written to be
              liftable on its own — one sentence that fully answers "what is
              FlockInsight". It is the same sentence as the meta description and
              the schema description, which is the entity consistency that
              decides whether four pages read as one product.
            */}
            <div className="bg-card mx-auto mt-14 max-w-3xl rounded-2xl border p-6 text-left shadow-sm">
              <p className="text-primary flex items-center gap-2 text-xs font-bold tracking-wider uppercase">
                <Quote aria-hidden className="size-3.5" />
                {s.summaryHeading}
              </p>
              <p className="mt-3 leading-relaxed text-pretty">
                {ENTITY_SENTENCE_SHORT}{" "}
                <span className="text-muted-foreground">
                  Engineered in Nigeria for congregations on mobile data rather
                  than office broadband, and used by churches across Africa and
                  Europe.
                </span>
              </p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------
            Proof strip — facts about the product, never about traction
            --------------------------------------------------------------- */}
        <section className="bg-muted/30 border-y py-12">
          <div className="mx-auto max-w-6xl px-4 lg:px-8">
            <h2 className="sr-only">{s.proofTitle}</h2>
            <dl className="grid grid-cols-2 gap-8 lg:grid-cols-4">
              {PROOF.map((p) => (
                <div key={p.label}>
                  <dt className="sr-only">{p.label}</dt>
                  <dd>
                    <span className="text-primary text-4xl font-extrabold lg:text-5xl">
                      {p.value}
                    </span>
                    <span className="mt-1 block text-sm font-bold">
                      {p.label}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">
                      {p.detail}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ---------------------------------------------------------------
            Pain points
            --------------------------------------------------------------- */}
        <section className="py-20 lg:py-24">
          <div className="mx-auto max-w-5xl px-4 lg:px-8">
            <SectionHeading
              eyebrow="Sound familiar?"
              title={c.painsTitle}
              intro={c.painsIntro}
            />
            <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {c.pains.map((p) => (
                <blockquote
                  key={p}
                  className="bg-card rounded-2xl border border-dashed p-5"
                >
                  <p className="text-muted-foreground italic text-pretty">{p}</p>
                </blockquote>
              ))}
            </div>
            <p className="mt-10 text-center text-lg font-semibold">
              {c.painsOutro}
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------
            What it replaces — the anchor, deliberately before pricing
            --------------------------------------------------------------- */}
        <section id="replaces" className="bg-muted/30 border-y py-20 lg:py-24">
          <div className="mx-auto max-w-5xl px-4 lg:px-8">
            <SectionHeading
              eyebrow="One bill"
              title={s.replacesTitle}
              id="replaces-heading"
            />
            <div className="mt-12">
              <ReplacesTable copy={s} />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------
            The eighteen modules
            --------------------------------------------------------------- */}
        <section id="modules" className="py-20 lg:py-28">
          <div className="mx-auto max-w-6xl px-4 lg:px-8">
            <SectionHeading
              eyebrow="Features"
              title={s.moduleTitle}
              intro={s.moduleIntro}
              id="modules-heading"
            />
            <div className="mt-12">
              <ModuleGroups features={c.features} allLabel={s.moduleGroupAll} />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------
            Built in Nigeria, which is why it works anywhere
            --------------------------------------------------------------- */}
        <section id="built-for" className="bg-muted/30 border-y py-20 lg:py-28">
          <div className="mx-auto max-w-6xl px-4 lg:px-8">
            <SectionHeading
              eyebrow="Why this one"
              title={c.builtForTitle}
              intro="Most church software is written for an American congregation with office broadband. These are the decisions that make this one different — and every one of them is checkable within an hour of signing up."
            />
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {c.builtFor.map((b) => (
                <Card key={b.title}>
                  <CardContent>
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="text-primary mt-0.5 size-5 shrink-0" />
                      <div>
                        <h3 className="font-bold">{b.title}</h3>
                        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed text-pretty">
                          {b.body}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------
            How it works
            --------------------------------------------------------------- */}
        <section id="how" className="py-20 lg:py-28">
          <div className="mx-auto max-w-6xl px-4 lg:px-8">
            <SectionHeading
              eyebrow="Simple process"
              title={c.stepsTitle}
              intro="No technical expertise required. Reading this page was the hard part."
            />
            <ol className="mt-14 grid gap-10 md:grid-cols-3">
              {c.steps.map((step, i) => (
                <li key={step.n} className="relative text-center">
                  {/*
                    A connector between the steps, desktop only. It turns three
                    cards into one sequence, which is the whole point of
                    numbering them.
                  */}
                  {i < c.steps.length - 1 ? (
                    <div
                      aria-hidden
                      className="from-primary/40 absolute top-8 left-[calc(50%+2.5rem)] hidden h-px w-[calc(100%-5rem)] bg-gradient-to-r to-transparent md:block"
                    />
                  ) : null}
                  <div className="from-primary mx-auto grid size-16 place-items-center rounded-2xl bg-gradient-to-br to-violet-500 text-2xl font-extrabold text-white shadow-lg shadow-primary/25">
                    {step.n}
                  </div>
                  <h3 className="mt-5 text-xl font-bold">{step.title}</h3>
                  <p className="text-muted-foreground mt-2 text-pretty">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
            {/*
              Momentum, honestly earned. A progress indicator that starts above
              zero roughly doubles completion, and this one is not a trick:
              choosing a platform genuinely is the step people stall on, and
              they have just done it.
            */}
            <div className="bg-card mx-auto mt-12 flex max-w-md items-center gap-3 rounded-xl border p-4">
              <Sparkles className="text-primary size-5 shrink-0" />
              <p className="text-sm">
                <span className="font-bold">Step 0 is already done.</span>{" "}
                <span className="text-muted-foreground">
                  Choosing is the part churches stall on for months.
                </span>
              </p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------
            Who it is for
            --------------------------------------------------------------- */}
        <section className="bg-muted/30 border-y py-20 lg:py-24">
          <div className="mx-auto max-w-6xl px-4 lg:px-8">
            <SectionHeading eyebrow="Built for" title={s.audienceTitle} />
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {AUDIENCE_CARDS.map((a) => (
                <div key={a.title} className="bg-card rounded-2xl border p-5">
                  <h3 className="font-bold">{a.title}</h3>
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed text-pretty">
                    {a.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------
            Honest comparison
            --------------------------------------------------------------- */}
        <section id="compare" className="py-20 lg:py-28">
          <div className="mx-auto max-w-5xl px-4 lg:px-8">
            <SectionHeading
              eyebrow="Straight comparison"
              title={s.compareTitle}
              id="compare-heading"
            />
            <div className="mt-12">
              <CompareTable copy={s} />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------
            Pricing
            --------------------------------------------------------------- */}
        <section id="pricing" className="bg-muted/30 border-y py-20 lg:py-28">
          <div className="mx-auto max-w-6xl px-4 lg:px-8">
            <SectionHeading
              eyebrow={nav.pricing}
              title={c.pricing.title}
              intro={c.pricing.intro}
            />
            <div className="mt-12 grid gap-5 lg:grid-cols-4">
              {plans.map((p) => {
                const localised = priced[p.id];
                const priceLabel = localised
                  ? planPriceLabelFor(localised, {
                      free: c.pricing.free,
                      perMonth: c.pricing.perMonth,
                    })
                  : "—";
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "bg-card relative flex flex-col rounded-3xl border p-6 shadow-sm",
                      p.highlight && "border-primary ring-primary/30 ring-2",
                    )}
                  >
                    {p.highlight && (
                      <span className="bg-primary text-primary-foreground absolute -top-3 left-6 rounded-full px-3 py-1 text-xs font-bold">
                        {c.pricing.mostPopular}
                      </span>
                    )}
                    <h3 className="text-xl font-extrabold">{p.name}</h3>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {p.tagline}
                    </p>
                    <div className="mt-4">
                      {p.priceMonthly && p.priceMonthly > 0 ? (
                        <>
                          <span className="text-muted-foreground text-xl font-bold line-through decoration-2">
                            {priceLabel}
                          </span>
                          <span className="text-primary ml-2 text-2xl font-extrabold">
                            {c.pricing.free}
                          </span>
                          <p className="text-primary mt-0.5 text-xs font-bold tracking-wide uppercase">
                            {c.pricing.firstSundays}
                          </p>
                        </>
                      ) : (
                        <span className="text-3xl font-extrabold tracking-tight">
                          {p.priceMonthly === null ? "—" : priceLabel}
                        </span>
                      )}
                    </div>
                    <ul className="mt-5 flex-1 space-y-2.5">
                      {p.features.slice(0, 5).map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm">
                          <Check className="text-primary mt-0.5 size-4 shrink-0" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      asChild
                      className="mt-6 w-full"
                      variant={p.highlight ? "default" : "outline"}
                      size="lg"
                    >
                      <Link href="/signup">
                        {p.priceMonthly === null
                          ? c.pricing.contactUs
                          : c.pricing.getStarted}
                      </Link>
                    </Button>
                  </div>
                );
              })}
            </div>
            {/* The currency and the card fee, said once. */}
            <p className="text-muted-foreground mt-8 text-center text-xs leading-relaxed">
              {currencyNote}
            </p>
            <p className="text-muted-foreground mt-4 text-center text-sm">
              {c.pricing.fullDetailsPre}{" "}
              <Link
                href="/pricing"
                className="text-primary font-semibold underline"
              >
                {c.pricing.pricingPageLink}
              </Link>
              .
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------
            FAQ — rendered and emitted as FAQPage structured data
            --------------------------------------------------------------- */}
        <section id="faq" className="py-20 lg:py-28">
          <div className="mx-auto max-w-3xl px-4 lg:px-8">
            <SectionHeading eyebrow="Questions" title={c.faqTitle} />
            <div className="mt-12 divide-y rounded-2xl border">
              {c.faq.map((f) => (
                <details key={f.q} className="group p-5">
                  <summary className="focus-visible:ring-ring flex cursor-pointer list-none items-start justify-between gap-4 rounded-md text-lg font-bold focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                    <h3 className="text-lg font-bold">{f.q}</h3>
                    <span
                      aria-hidden
                      className="text-primary mt-1 shrink-0 text-xl leading-none transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="text-muted-foreground mt-3 leading-relaxed text-pretty">
                    {f.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------
            Final CTA
            --------------------------------------------------------------- */}
        <section className="py-20 lg:py-28">
          <div className="mx-auto max-w-4xl px-4 lg:px-8">
            <Card className="from-primary overflow-hidden bg-gradient-to-br to-violet-600 text-center text-white">
              <CardContent className="px-6 py-14">
                <h2 className="text-3xl font-extrabold tracking-tight text-balance lg:text-4xl">
                  {c.ctaTitle}
                </h2>
                <p className="mx-auto mt-4 max-w-2xl text-lg text-white/85 text-pretty">
                  Set your church up in about half an hour and record your first
                  Sunday the same week. Seven Sundays free, and your data is
                  yours to take at any time.
                </p>
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <Button asChild size="xl" variant="secondary">
                    <Link href="/signup">
                      {c.hero.ctaPrimary} <ArrowRight className="size-5" />
                    </Link>
                  </Button>
                </div>
                {/*
                  Objection handlers beside the button, not in fine print. These
                  are the three things that stop a pastor clicking, and each of
                  them is literally true.
                */}
                <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/85">
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="size-4" /> No card required
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="size-4" /> Every feature on
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="size-4" /> Full export whenever you
                    ask
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      <PublicFooter
        footer={c.footer}
        nav={nav}
        pricing={c.pricing}
        tagline={c.footerTagline}
      />
    </div>
  );
}
