import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Quote,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicHeader } from "@/components/landing/public-header";
import { PublicFooter } from "@/components/landing/public-footer";
import { SectionHeading } from "@/components/landing/section-heading";
import { JsonLd } from "@/components/seo/json-ld";
import type { LandingContent } from "@/lib/landing-content";
import type { PageContent } from "@/lib/seo/pages";
import type { Crumb } from "@/lib/seo/schema";

/**
 * The shared shell for the twenty-two generated pages.
 *
 * One template, three routes (country, solution, comparison), so the parts that
 * must be right everywhere — breadcrumbs, the extractable summary, the FAQ
 * markup, the related links, the CTA — are right in one place rather than
 * drifting across twenty-two files.
 *
 * ## The order of the page is the argument
 *
 * 1. **Breadcrumb**, so a page three levels deep is not an orphan.
 * 2. **H1 as a sentence**, then the **summary** immediately under it. Content
 *    near the top of a page is weighted most heavily by the systems that build
 *    AI answers, and the summary is written to be liftable on its own — it
 *    answers the search question in full without the rest of the page.
 * 3. **The specifics.** Every point has to be checkable in the product.
 * 4. **`children`** — whatever is true of this page and no other: a country's
 *    real currency and timezone, who should buy the competitor instead.
 * 5. **FAQ**, rendered and marked up from the same array.
 * 6. **Related pages**, which is how twenty-two generated pages stop being
 *    twenty-two dead ends and start passing authority between each other.
 * 7. **CTA**, with the objections answered beside the button rather than in
 *    fine print underneath it.
 */
export function SeoPage({
  content,
  crumbs,
  eyebrow,
  jsonLd,
  copy,
  children,
  related,
}: {
  content: PageContent;
  /** Breadcrumb trail, excluding Home — the schema builder adds that. */
  crumbs: Crumb[];
  /** The small label above the H1: the country, the module, the competitor. */
  eyebrow: string;
  jsonLd: unknown[];
  copy: LandingContent;
  /** The part that is true of this page and no other. */
  children?: React.ReactNode;
  related: { label: string; href: string }[];
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <JsonLd data={jsonLd} />
      <PublicHeader nav={copy.nav} />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,theme(colors.primary/10%),transparent)]"
          />
          <div className="mx-auto max-w-4xl px-4 py-14 lg:px-8 lg:py-20">
            {/*
              A real <nav> with an ordered list. The visible breadcrumb and the
              BreadcrumbList schema are built from the same `crumbs` array, so
              they cannot disagree — a mismatch between the two is treated as
              cloaking rather than as a bug.
            */}
            <nav aria-label="Breadcrumb">
              <ol className="text-muted-foreground flex flex-wrap items-center gap-1 text-sm">
                <li>
                  <Link href="/" className="hover:text-primary">
                    Home
                  </Link>
                </li>
                {crumbs.map((cr, i) => (
                  <li key={cr.path} className="flex items-center gap-1">
                    <ChevronRight aria-hidden className="size-3.5 shrink-0" />
                    {i === crumbs.length - 1 ? (
                      <span aria-current="page" className="text-foreground font-medium">
                        {cr.name}
                      </span>
                    ) : (
                      <Link href={cr.path} className="hover:text-primary">
                        {cr.name}
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            </nav>

            <p className="text-primary mt-8 text-sm font-bold tracking-wider uppercase">
              {eyebrow}
            </p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-balance sm:text-4xl lg:text-5xl">
              {content.h1}
            </h1>

            {/* The extractable summary. */}
            <div className="bg-card mt-8 rounded-2xl border p-6 shadow-sm">
              <p className="text-primary flex items-center gap-2 text-xs font-bold tracking-wider uppercase">
                <Quote aria-hidden className="size-3.5" />
                In short
              </p>
              <p className="mt-3 text-lg leading-relaxed text-pretty">
                {content.summary}
              </p>
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/signup">
                  {copy.hero.ctaPrimary} <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/pricing">{copy.pricing.pricingPageLink}</Link>
              </Button>
            </div>
            <p className="text-muted-foreground mt-3 text-sm">
              {copy.hero.reassurance}
            </p>
          </div>
        </section>

        {/* The specifics */}
        <section className="py-16 lg:py-20">
          <div className="mx-auto max-w-4xl px-4 lg:px-8">
            <h2 className="text-2xl font-extrabold tracking-tight lg:text-3xl">
              How it actually works
            </h2>
            <div className="mt-8 space-y-5">
              {content.points.map((p) => (
                <div
                  key={p.title}
                  className="bg-card flex items-start gap-4 rounded-2xl border p-5"
                >
                  <CheckCircle2 className="text-primary mt-0.5 size-5 shrink-0" />
                  <div>
                    <h3 className="font-bold">{p.title}</h3>
                    <p className="text-muted-foreground mt-1.5 leading-relaxed text-pretty">
                      {p.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {children}

        {/* FAQ */}
        <section className="bg-muted/30 border-y py-16 lg:py-20">
          <div className="mx-auto max-w-3xl px-4 lg:px-8">
            <SectionHeading
              align="left"
              eyebrow="Questions"
              title="Questions people ask"
              className="max-w-none"
            />
            <div className="bg-card mt-8 divide-y rounded-2xl border">
              {content.faq.map((f) => (
                <details key={f.q} className="group p-5">
                  <summary className="focus-visible:ring-ring flex cursor-pointer list-none items-start justify-between gap-4 rounded-md focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                    <h3 className="font-bold">{f.q}</h3>
                    <span
                      aria-hidden
                      className="text-primary mt-0.5 shrink-0 text-xl leading-none transition-transform group-open:rotate-45"
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

        {/* Related — the internal link graph these pages live or die by */}
        <section className="py-16 lg:py-20">
          <div className="mx-auto max-w-4xl px-4 lg:px-8">
            <h2 className="text-2xl font-extrabold tracking-tight">
              Keep reading
            </h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {related.map((r) => (
                <li key={r.href}>
                  <Link
                    href={r.href}
                    className="bg-card hover:border-primary hover:text-primary group flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-semibold transition-colors"
                  >
                    {r.label}
                    <ArrowRight
                      aria-hidden
                      className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* CTA */}
        <section className="pb-20 lg:pb-28">
          <div className="mx-auto max-w-4xl px-4 lg:px-8">
            <div className="from-primary rounded-3xl bg-gradient-to-br to-violet-600 px-6 py-12 text-center text-white">
              <h2 className="text-2xl font-extrabold tracking-tight text-balance lg:text-3xl">
                {copy.ctaTitle}
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-white/85 text-pretty">
                {copy.ctaBody}
              </p>
              <Button asChild size="xl" variant="secondary" className="mt-7">
                <Link href="/signup">
                  {copy.hero.ctaPrimary} <ArrowRight className="size-5" />
                </Link>
              </Button>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-white/85">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="size-4" /> No card required
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="size-4" /> Full export whenever you ask
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter
        footer={copy.footer}
        nav={copy.nav}
        pricing={copy.pricing}
        tagline={copy.footerTagline}
      />
    </div>
  );
}
