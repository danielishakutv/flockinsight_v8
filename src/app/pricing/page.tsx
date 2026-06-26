import Link from "next/link";
import { Check } from "lucide-react";
import { planPriceLabel } from "@/lib/plans";
import { getPlans } from "@/lib/pricing";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Pricing",
  description:
    "Simple, affordable plans for churches of every size — built for Nigeria and Africa. Start free.",
};

export default async function PricingPage() {
  const plans = await getPlans();
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 lg:px-8">
        <Link href="/">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/churches">Find a church</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">Start free</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 lg:px-8">
        <div className="mx-auto max-w-2xl py-10 text-center lg:py-16">
          <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl">
            Simple pricing for every church
          </h1>
          <p className="text-muted-foreground mt-4 text-lg">
            Start free and grow as your congregation grows. Prices in Naira, no
            card required to begin.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-4">
          {plans.map((p) => (
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
                  Most popular
                </span>
              )}
              <h2 className="text-xl font-extrabold">{p.name}</h2>
              <p className="text-muted-foreground mt-1 text-sm">{p.tagline}</p>
              <div className="mt-4 flex items-end gap-1">
                <span className="text-3xl font-extrabold tracking-tight">
                  {planPriceLabel(p)}
                </span>
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
                <Link href={p.id === "enterprise" ? "/signup" : "/signup"}>
                  {p.priceMonthly === null ? "Contact us" : "Get started"}
                </Link>
              </Button>
            </div>
          ))}
        </div>

        <p className="text-muted-foreground mt-10 text-center text-sm">
          Need something custom for a denomination or multi-branch ministry?{" "}
          <Link href="/signup" className="text-primary font-semibold underline">
            Talk to us
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
