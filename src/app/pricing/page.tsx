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
import { PublicHeader } from "@/components/landing/public-header";
import { PublicFooter } from "@/components/landing/public-footer";
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
    <div className="flex min-h-dvh flex-col">
      <PromoPopup />
      {/*
        The shared header, not a second hand-rolled one.
        The bespoke bar this replaces put four buttons and a language menu in
        an unwrapped flex row: 623px of content in a 390px viewport, so the
        whole pricing page scrolled sideways on every phone. It also meant the
        one page a buyer reads before paying was the only public page with no
        route to the solution, country and comparison pages.
      */}
      <PublicHeader nav={nav} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 lg:px-8">
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
                      {/*
                        `break-words` because a feature line is prose written
                        elsewhere (lib/plans.ts, or an override saved at
                        /superadmin/pricing) and may contain a long unbreakable
                        token. The short-links line names an example address,
                        which at 320px is wider than the column and cannot wrap
                        on its own — the mobile audit catches that as HIGH,
                        because the CSS cannot behave any other way. A general
                        guard here rather than reworded copy: the next long
                        token would hit the same wall.
                      */}
                      <span className="break-words">{f}</span>
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

      <PublicFooter
        footer={content.footer}
        nav={nav}
        pricing={t}
        tagline={content.footerTagline}
      />
    </div>
  );
}
