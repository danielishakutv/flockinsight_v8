import Link from "next/link";
import { ChevronDown, Menu } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { PublicLanguageMenu } from "@/components/public/public-language-menu";
import { LandingHeaderAuth } from "@/components/landing-header-auth";
import { GEO_TERMS, USE_CASE_TERMS, COMPARISON_TERMS } from "@/lib/seo/keywords";
import { comparePath, countryPath, solutionPath } from "@/lib/seo/pages";
import type { NavCopy } from "@/lib/landing-content";

/**
 * The public header.
 *
 * ## The mobile menu has no JavaScript, on purpose
 *
 * It is a native `<details>`. Three reasons, in increasing order of how much
 * they cost to learn the hard way:
 *
 * 1. The marketing pages are the ones people open on bad connections. A
 *    client component for a menu is a bundle, a hydration wait, and a button
 *    that does nothing until it arrives.
 * 2. `<details>` is keyboard- and screen-reader-operable with no work and no
 *    ARIA. Every hand-rolled drawer in the world is worse at this.
 * 3. **This header has `backdrop-blur`, and that makes it the containing block
 *    for `position: fixed` descendants.** A `fixed inset-0` drawer rendered
 *    inside it resolves against the 56px header instead of the viewport, so the
 *    menu opens as an empty sliver. That has already happened once in this
 *    codebase — `superadmin-nav.tsx` had to be rewritten to portal into
 *    `document.body` because of it. The panel below is `absolute`, positioned
 *    against this header deliberately, which is the one thing the blur does not
 *    break.
 *
 * ## Why the nav got bigger
 *
 * The dropdowns list the solution, country and comparison pages. That is not
 * decoration: pages linked only from a sitemap are crawled late and ranked
 * poorly, and pages linked from every page of the site are crawled on the next
 * pass. The header and footer are where generated pages earn their crawl
 * budget. `<details>` again, so the desktop dropdowns are also free.
 */
export function PublicHeader({ nav }: { nav: NavCopy }) {
  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      {/*
        `px-3` and `gap-2` below `sm`, not `px-4 gap-4`.
        At 390px the wordmark plus the right-hand group came to 395px and the
        whole page scrolled sideways by five pixels — the kind of overflow that
        is invisible on a desktop browser narrowed to phone width (the
        scrollbar hides it) and obvious on an actual phone.
      */}
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-4 lg:px-8">
        <Link href="/" aria-label="FlockInsight home">
          {/*
            Mark only below 400px. With the name, the logo plus the CTA plus
            the menu button came to 341px inside a 320px viewport — and 320px
            is the width this project's own mobile audit assumes, because it is
            still a real phone.
          */}
          <Wordmark textClassName="max-[400px]:hidden" />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 text-sm font-semibold lg:flex">
          <NavDropdown label={nav.features}>
            <NavColumn title="By job">
              {USE_CASE_TERMS.map((t) => (
                <NavItem key={t.primary} href={solutionPath(t)}>
                  {titleise(t.primary)}
                </NavItem>
              ))}
            </NavColumn>
            <NavColumn title="All of it">
              <NavItem href="/#modules">Every module</NavItem>
              <NavItem href="/#replaces">What it replaces</NavItem>
              <NavItem href="/#how">{nav.howItWorks}</NavItem>
              <NavItem href="/demo">{nav.bookDemo}</NavItem>
            </NavColumn>
          </NavDropdown>

          <NavDropdown label="Where">
            <NavColumn title="By country">
              {GEO_TERMS.map((t) => (
                <NavItem key={t.country} href={countryPath(t)}>
                  {t.country}
                </NavItem>
              ))}
            </NavColumn>
          </NavDropdown>

          <NavDropdown label="Compare">
            <NavColumn title="Instead of">
              {COMPARISON_TERMS.map((t) => (
                <NavItem key={t.primary} href={comparePath(t)}>
                  {t.competitor}
                </NavItem>
              ))}
            </NavColumn>
          </NavDropdown>

          <Link
            href="/pricing"
            className="hover:text-primary rounded-md px-3 py-2"
          >
            {nav.pricing}
          </Link>
          <Link
            href="/churches"
            className="hover:text-primary rounded-md px-3 py-2"
          >
            {nav.findChurch}
          </Link>
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/*
            The language picker moves into the drawer on a phone. It is 40px
            plus a gap, which is most of the overflow, and a globe icon beside
            a hamburger is two menus competing for the same corner.
          */}
          <PublicLanguageMenu className="max-lg:hidden" />
          <LandingHeaderAuth />

          {/* Mobile menu: native disclosure, no JS. */}
          <details className="group relative lg:hidden">
            <summary
              className="hover:bg-muted focus-visible:ring-ring grid size-10 cursor-pointer list-none place-items-center rounded-lg focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
              aria-label="Menu"
            >
              <Menu className="size-5" />
            </summary>
            {/*
              `absolute`, not `fixed`. See the note at the top of this file: the
              blur on this header would resolve a fixed child against the header
              instead of the viewport.
            */}
            <div className="bg-background absolute right-0 top-12 z-50 max-h-[calc(100dvh-5rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border p-4 shadow-2xl">
              <MobileGroup title={nav.features}>
                {USE_CASE_TERMS.map((t) => (
                  <NavItem key={t.primary} href={solutionPath(t)}>
                    {titleise(t.primary)}
                  </NavItem>
                ))}
              </MobileGroup>
              <MobileGroup title="Where">
                {GEO_TERMS.map((t) => (
                  <NavItem key={t.country} href={countryPath(t)}>
                    {t.country}
                  </NavItem>
                ))}
              </MobileGroup>
              <MobileGroup title="Compare">
                {COMPARISON_TERMS.map((t) => (
                  <NavItem key={t.primary} href={comparePath(t)}>
                    {t.competitor}
                  </NavItem>
                ))}
              </MobileGroup>
              <MobileGroup title="Language">
                {/* Moved here from the bar, where it did not fit. */}
                <li className="px-2 py-1">
                  <PublicLanguageMenu />
                </li>
              </MobileGroup>
              <MobileGroup title="More">
                <NavItem href="/pricing">{nav.pricing}</NavItem>
                <NavItem href="/churches">{nav.findChurch}</NavItem>
                <NavItem href="/demo">{nav.bookDemo}</NavItem>
                <NavItem href="/blog">Blog</NavItem>
              </MobileGroup>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

/** `church attendance app` -> `Church attendance app`. Sentence case, not Title Case. */
function titleise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function NavDropdown({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group relative">
      <summary className="hover:text-primary focus-visible:ring-ring flex cursor-pointer list-none items-center gap-1 rounded-md px-3 py-2 focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown
          aria-hidden
          className="size-3.5 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="bg-background absolute left-0 top-10 z-50 flex gap-8 rounded-2xl border p-5 shadow-2xl">
        {children}
      </div>
    </details>
  );
}

function NavColumn({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-48">
      <p className="text-muted-foreground mb-2 text-[11px] font-bold tracking-wider uppercase">
        {title}
      </p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function MobileGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b py-3 first:pt-0 last:border-b-0 last:pb-0">
      <p className="text-muted-foreground mb-1.5 text-[11px] font-bold tracking-wider uppercase">
        {title}
      </p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function NavItem({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="hover:bg-muted hover:text-primary block rounded-md px-2 py-1.5 text-sm font-medium"
      >
        {children}
      </Link>
    </li>
  );
}
