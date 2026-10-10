import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { PublicHeader } from "@/components/landing/public-header";
import { PublicFooter } from "@/components/landing/public-footer";
import { Button } from "@/components/ui/button";
import { JsonLd } from "@/components/seo/json-ld";
import type { LandingContent } from "@/lib/landing-content";

/**
 * A hub page: the index above a set of generated pages.
 *
 * These exist for two reasons, one obvious and one not.
 *
 * The obvious one is that the breadcrumbs on twenty-two pages point at
 * `/solutions`, `/compare` and `/church-management-software`, and a breadcrumb
 * trail whose middle link is a 404 is worse than no breadcrumb — it tells a
 * crawler the site's own idea of its structure is wrong.
 *
 * The less obvious one is that a hub page is where a set of pages becomes a
 * topic. Twenty-two pages each linked from a footer are twenty-two pages; the
 * same pages gathered under a page that explains what the set IS read as a
 * section with a subject, which is how topical authority is actually
 * accumulated.
 *
 * `ItemList` schema is emitted for the same reason: it states explicitly that
 * these URLs are a set, in an order, with names.
 */
export function SeoIndex({
  title,
  intro,
  eyebrow,
  items,
  copy,
  jsonLd,
}: {
  title: string;
  intro: string;
  eyebrow: string;
  items: { name: string; href: string; detail: string }[];
  copy: LandingContent;
  jsonLd: unknown[];
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <JsonLd data={jsonLd} />
      <PublicHeader nav={copy.nav} />

      <main className="flex-1">
        <section className="relative overflow-hidden border-b">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,theme(colors.primary/10%),transparent)]"
          />
          <div className="mx-auto max-w-4xl px-4 py-14 lg:px-8 lg:py-20">
            <nav aria-label="Breadcrumb">
              <ol className="text-muted-foreground flex items-center gap-1 text-sm">
                <li>
                  <Link href="/" className="hover:text-primary">
                    Home
                  </Link>
                </li>
                <li className="flex items-center gap-1">
                  <ChevronRight aria-hidden className="size-3.5" />
                  <span aria-current="page" className="text-foreground font-medium">
                    {eyebrow}
                  </span>
                </li>
              </ol>
            </nav>
            <p className="text-primary mt-8 text-sm font-bold tracking-wider uppercase">
              {eyebrow}
            </p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-balance sm:text-4xl lg:text-5xl">
              {title}
            </h1>
            <p className="text-muted-foreground mt-6 max-w-2xl text-lg text-pretty">
              {intro}
            </p>
          </div>
        </section>

        <section className="py-14 lg:py-20">
          <div className="mx-auto max-w-4xl px-4 lg:px-8">
            <ul className="grid gap-4 sm:grid-cols-2">
              {items.map((it) => (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    className="bg-card hover:border-primary group flex h-full flex-col rounded-2xl border p-5 transition-all hover:shadow-lg hover:shadow-primary/5"
                  >
                    <span className="group-hover:text-primary flex items-center justify-between gap-3 font-bold">
                      {it.name}
                      <ArrowRight
                        aria-hidden
                        className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                      />
                    </span>
                    <span className="text-muted-foreground mt-2 text-sm leading-relaxed text-pretty">
                      {it.detail}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            <div className="mt-12 text-center">
              <Button asChild size="xl">
                <Link href="/signup">
                  {copy.hero.ctaPrimary} <ArrowRight className="size-5" />
                </Link>
              </Button>
              <p className="text-muted-foreground mt-3 text-sm">
                {copy.hero.reassurance}
              </p>
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

/**
 * `ItemList` for a hub page. Says explicitly that these URLs are one set.
 */
export function itemListSchema(
  path: string,
  site: string,
  items: { name: string; href: string }[],
) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${site}${path}#list`,
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      url: `${site}${it.href}`,
    })),
  };
}
