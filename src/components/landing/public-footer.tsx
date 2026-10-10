import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { GEO_TERMS, COMPARISON_TERMS } from "@/lib/seo/keywords";
import { SOLUTION_TERMS, comparePath, countryPath, solutionPath } from "@/lib/seo/pages";
import type { FooterCopy, NavCopy, PricingCopy } from "@/lib/landing-content";

/**
 * The public footer, and the site's internal link graph.
 *
 * This is doing more work than a footer usually does. Twenty-two generated
 * pages linked only from `sitemap.xml` get crawled late and ranked as orphans;
 * the same pages linked from the footer of every public page get crawled on the
 * next pass and inherit a share of whatever authority the home page has. A
 * sitemap tells a crawler a URL exists. An internal link tells it the URL
 * matters.
 *
 * It is also the only navigation on the site that lists everything, which makes
 * it genuinely useful to a person who has scrolled to the bottom looking for
 * the thing the header did not surface.
 *
 * The authorship line is deliberately NOT here. Per the house rule, the maker
 * footer belongs on the sign-in page only — a maker's name on a church's own
 * signed-in pages reads as something gone wrong — and the copyright line below
 * is the company's, which is a different thing.
 */
export function PublicFooter({
  footer,
  nav,
  pricing,
  tagline,
}: {
  footer: FooterCopy;
  nav: NavCopy;
  pricing: PricingCopy;
  /** `footerTagline` from the landing copy — it lives beside the hero, not in FooterCopy. */
  tagline: string;
}) {
  return (
    <footer className="border-t py-14">
      <div className="mx-auto max-w-6xl px-4 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="sm:col-span-2 lg:col-span-1">
            <Wordmark />
            <p className="text-muted-foreground mt-3 max-w-xs text-sm text-pretty">
              {tagline}
            </p>
          </div>

          <FooterColumn title="By job">
            {/*
              Solutions first. These are the pages with the clearest buying
              intent, and the ones a crawler should see highest in the markup.
            */}
            {SOLUTION_TERMS.slice(0, 7).map((t) => (
              <FooterLink key={t.primary} href={solutionPath(t)}>
                {sentence(t.primary)}
              </FooterLink>
            ))}
          </FooterColumn>

          <FooterColumn title="By country">
            {GEO_TERMS.map((t) => (
              <FooterLink key={t.country} href={countryPath(t)}>
                {t.country}
              </FooterLink>
            ))}
          </FooterColumn>

          <FooterColumn title="Compare">
            {COMPARISON_TERMS.map((t) => (
              <FooterLink key={t.primary} href={comparePath(t)}>
                {t.competitor}
              </FooterLink>
            ))}
            {/*
              The differentiator pages live here rather than in "By job": a
              person who clicks "Compare" is already shopping, and "works on a
              slow connection" is a comparison even when no competitor is named.
            */}
            {SOLUTION_TERMS.slice(7).map((t) => (
              <FooterLink key={t.primary} href={solutionPath(t)}>
                {sentence(t.primary)}
              </FooterLink>
            ))}
          </FooterColumn>

          <FooterColumn title={footer.company}>
            <FooterLink href="/pricing">{nav.pricing}</FooterLink>
            <FooterLink href="/churches">{nav.findChurch}</FooterLink>
            <FooterLink href="/events">Church events</FooterLink>
            <FooterLink href="/blog">{footer.blog}</FooterLink>
            <FooterLink href="/changelog">{footer.whatsNew}</FooterLink>
            <FooterLink href="/roadmap">{footer.roadmap}</FooterLink>
            <FooterLink href="/demo">{footer.bookWalkthrough}</FooterLink>
            <FooterLink href="/signup">{pricing.getStarted}</FooterLink>
            <li>
              <a
                href="mailto:support@flockinsight.com"
                className="hover:text-primary"
              >
                {footer.contact}
              </a>
            </li>
            <FooterLink href="/privacy">{footer.privacy}</FooterLink>
            <FooterLink href="/terms">{footer.terms}</FooterLink>
          </FooterColumn>
        </div>

        <div className="text-muted-foreground mt-12 flex flex-col items-center gap-2 border-t pt-8 text-center text-sm">
          <p>© {new Date().getFullYear()} Toko Technologies. All rights reserved.</p>
          {/*
            A plain-text brief for AI assistants, linked so it can be found. It
            is the file that stops an assistant describing the product from a
            marketing page, and a link is how a crawler learns it is there.
          */}
          <p className="text-xs">
            <a href="/llms.txt" className="hover:text-primary underline decoration-dotted">
              llms.txt
            </a>
            {" · "}
            <a
              href="/llms-full.txt"
              className="hover:text-primary underline decoration-dotted"
            >
              llms-full.txt
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}

function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function FooterColumn({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-sm font-bold">{title}</p>
      <ul className="text-muted-foreground mt-3 space-y-2 text-sm">{children}</ul>
    </div>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link href={href} className="hover:text-primary">
        {children}
      </Link>
    </li>
  );
}
