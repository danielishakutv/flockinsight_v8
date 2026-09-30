import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { getPlans } from "@/lib/pricing";
import { landingContent } from "@/lib/landing-content";
import { getLocale } from "@/lib/i18n/server";
import {
  currencyNoteFor,
  planPriceLabelFor,
  pricesForCountry,
  requestCountry,
} from "@/lib/plan-price";
import { Wordmark } from "@/components/brand";
import { PublicLanguageMenu } from "@/components/public/public-language-menu";
import { PromoPopup } from "@/components/public/promo-popup";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * Never prerendered. This page varies by cookie (the language) and by header
 * (the country, and therefore the currency and the total), so a build-time
 * copy would serve one visitor's page to everybody. Declared rather than
 * inferred: `requestCountry` catches its own errors, which would otherwise
 * swallow the signal Next uses to bail out of a static render.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pricing",
  description:
    "Simple, affordable plans for churches of every size — built for Nigeria and Africa. Start free.",
};

export default async function PricingPage() {
  /*
   * Three things vary by visitor here: the language, the currency, and the
   * total. All three are resolved on the server in one pass, so the page that
   * renders is the page that visitor should see — no flash of naira, and no
   * client-side conversion that could disagree with what checkout charges.
   */
  const [plans, locale, country] = await Promise.all([
    getPlans(),
    getLocale(),
    requestCountry(),
  ]);
  const content = landingContent(locale);
  const t = content.pricing;
  const nav = content.nav;
  const priced = await pricesForCountry(
    Object.fromEntries(plans.map((p) => [p.id, p.priceMonthly])),
    country,
  );
  const currencyNote = currencyNoteFor(priced, t);

  return (
    <div className="min-h-dvh">
      <PromoPopup />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 lg:px-8">
        <Link href="/">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-2">
          <PublicLanguageMenu />
          <Button asChild variant="ghost" size="sm">
            <Link href="/churches">{nav.findChurch}</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/demo">{nav.bookDemo}</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">{nav.logIn}</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">{nav.startFree}</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 lg:px-8">
        <div className="mx-auto max-w-2xl py-10 text-center lg:py-16">
          <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl">
            {t.title}
          </h1>
          <p className="text-muted-foreground mt-4 text-lg">{t.intro}</p>
          <div className="bg-primary/10 text-primary mx-auto mt-6 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold">
            <Sparkles className="size-4" /> {t.promo}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-4">
          {plans.map((p) => {
            const price = priced[p.id];
            const label = price
              ? planPriceLabelFor(price, { free: t.free, perMonth: t.perMonth })
              : "—";
            const paid = p.priceMonthly !== null && p.priceMonthly > 0;
            return (
              <div
                key={p.id}
                className={cn(
                  "relative flex flex-col rounded-3xl border p-6 shadow-sm",
                  p.highlight
                    ? "border-primary ring-primary/30 bg-card ring-2"
                    : "bg-card",
                )}
              >
                {p.highlight && (
                  <span className="bg-primary text-primary-foreground absolute -top-3 left-6 rounded-full px-3 py-1 text-xs font-bold">
                    {t.mostPopular}
                  </span>
                )}
                <h2 className="text-xl font-extrabold">{p.name}</h2>
                <p className="text-muted-foreground mt-1 text-sm">{p.tagline}</p>
                <div className="mt-4">
                  {paid ? (
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-muted-foreground text-xl font-bold line-through decoration-2">
                        {label}
                      </span>
                      <span className="text-primary text-2xl font-extrabold">
                        {t.free}
                      </span>
                      <span className="text-primary basis-full text-xs font-bold uppercase tracking-wide">
                        {t.firstSundays}
                      </span>
                    </div>
                  ) : (
                    <span className="text-3xl font-extrabold tracking-tight">
                      {p.priceMonthly === null ? "—" : label}
                    </span>
                  )}
                </div>
                <ul className="mt-5 flex-1 space-y-2.5">
                  {p.features.map((f) => (
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
                    {p.priceMonthly === null ? t.contactUs : t.getStarted}
                  </Link>
                </Button>
              </div>
            );
          })}
        </div>

        {/*
          The currency and the card fee, said once. For a Nigerian visitor this
          is a four-word note; for anyone else it is the difference between a
          price and a surprise on a statement.
        */}
        <p className="text-muted-foreground mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed">
          {currencyNote}
        </p>

        <p className="text-muted-foreground mt-10 text-center text-sm">
          {t.customTitle}{" "}
          <Link href="/signup" className="text-primary font-semibold underline">
            {t.talkToUs}
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
