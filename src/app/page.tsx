import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileText,
  FolderOpen,
  Globe,
  GraduationCap,
  HandCoins,
  HeartHandshake,
  Mail,
  MessageSquare,
  Network,
  ShieldCheck,
  Star,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Wordmark } from "@/components/brand";
import { LandingHeaderAuth } from "@/components/landing-header-auth";
import { JsonLd } from "@/components/seo/json-ld";
import { PromoPopup } from "@/components/public/promo-popup";
import { siteUrl } from "@/lib/site";
import { getPlans } from "@/lib/pricing";
import { planPriceLabel } from "@/lib/plans";
import { APP_VERSION } from "@/lib/version";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  AUDIENCES,
  BUILT_FOR,
  FAQ,
  FEATURES,
  HIGHLIGHTS,
  PAINS,
  STEPS,
} from "@/lib/landing-content";

export const metadata: Metadata = {
  title: "FlockInsight — Church Management Software for Africa",
  description:
    "Church management software for attendance, members, groups, training, giving, church finances, follow-up, bulk SMS and email, events, forms and your own public page. Built for churches in Nigeria and across Africa. First 7 Sundays free.",
  keywords: [
    "church management software",
    "church management software Nigeria",
    "church attendance app",
    "church membership software",
    "church giving and tithe tracking",
    "church accounting software Africa",
    "bulk SMS for churches",
    "ChMS Africa",
    "fellowship management software",
    "church database",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    title: "FlockInsight — Church Management Software for Africa",
    description:
      "Attendance, members, training, giving, finance, follow-up, SMS and your own public page — one app for churches, fellowships and ministries.",
  },
};

/** Static: the copy only changes when we deploy, so serve it from the edge. */
export const revalidate = 3600;

/** Feature icon keys → components. Keeps the copy free of JSX. */
const FEATURE_ICONS: Record<string, LucideIcon> = {
  attendance: ClipboardCheck,
  members: Users,
  groups: UsersRound,
  training: GraduationCap,
  giving: HandCoins,
  finance: Wallet,
  followup: HeartHandshake,
  comms: MessageSquare,
  reminders: Bell,
  forms: FileText,
  events: CalendarDays,
  media: FolderOpen,
  devotionals: Mail,
  public: Globe,
  analytics: BarChart3,
  reports: Database,
  branches: Network,
  roles: ShieldCheck,
};

export default async function LandingPage() {
  const site = siteUrl();
  /**
   * Structured data, for search engines and for AI assistants.
   *
   * The FAQ is emitted from the same array the page renders, so the two can
   * never disagree — a mismatch between visible content and structured data is
   * treated as cloaking. There is deliberately no AggregateRating: we have no
   * verified reviews, and inventing them is exactly the kind of thing that
   * loses a domain its rich results.
   */
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${site}/#organization`,
      name: "FlockInsight",
      alternateName: "FlockInsight Church Management",
      url: site,
      logo: { "@type": "ImageObject", url: `${site}/icon-512`, width: 512, height: 512 },
      description:
        "Church management software for churches, fellowships and ministries in Nigeria and across Africa.",
      email: "support@flockinsight.com",
      parentOrganization: { "@type": "Organization", name: "Toko Technologies" },
      areaServed: [
        { "@type": "Country", name: "Nigeria" },
        { "@type": "Place", name: "Africa" },
      ],
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "support@flockinsight.com",
        availableLanguage: ["English"],
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${site}/#website`,
      name: "FlockInsight",
      url: site,
      publisher: { "@id": `${site}/#organization` },
      inLanguage: "en",
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${site}/churches?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "@id": `${site}/#software`,
      name: "FlockInsight",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Church Management Software",
      operatingSystem: "Web browser, Android, iOS",
      url: site,
      publisher: { "@id": `${site}/#organization` },
      description:
        "All-in-one church management: attendance, members and households, groups and ministries, training and classes, giving with projects and pledges, church finances, visitor follow-up, bulk SMS and email, automatic reminders, events, forms, sermon media, devotionals, reports and a public church page.",
      featureList: FEATURES.map((f) => f.title),
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "NGN",
        description: "First 7 Sundays free, no card required.",
      },
      softwareVersion: APP_VERSION,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": `${site}/#faq`,
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];
  const plans = await getPlans();
  return (
    <div className="flex min-h-dvh flex-col">
      <JsonLd data={jsonLd} />
      <PromoPopup />
      {/* Header */}
      <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 lg:px-8">
          <Wordmark />
          <nav className="hidden items-center gap-8 text-sm font-semibold md:flex">
            <a href="#features" className="hover:text-primary">Features</a>
            <a href="#how" className="hover:text-primary">How It Works</a>
            <a href="#pricing" className="hover:text-primary">Pricing</a>
            <a href="#faq" className="hover:text-primary">FAQ</a>
            <Link href="/churches" className="hover:text-primary">Find a church</Link>
          </nav>
          <div className="flex items-center gap-2">
            <LandingHeaderAuth />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,theme(colors.primary/14%),transparent)]"
          />
          <div className="mx-auto max-w-4xl px-4 py-20 text-center lg:py-28">
            <span className="bg-primary/10 text-primary inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold">
              <Star className="size-4 fill-current" />
              For churches, fellowships & ministries
            </span>
            <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Everything your ministry needs,{" "}
              <span className="text-primary">in one simple app</span>
            </h1>
            <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg text-balance">
              Stop juggling notebooks, spreadsheets and WhatsApp groups.
              Attendance, members, groups, classes, giving, church finances and
              follow-up. Bulk SMS and free email, reminders that send
              themselves, events, forms, sermons and your own public page —
              one login, built for Africa.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="xl">
                <Link href="/signup">
                  Create Free Account <ArrowRight className="size-5" />
                </Link>
              </Button>
              <Button asChild size="xl" variant="outline">
                <Link href="/demo">Book a free walkthrough</Link>
              </Button>
              <Button asChild size="xl" variant="ghost">
                <Link href="/login">Login to Dashboard</Link>
              </Button>
            </div>
            <p className="text-muted-foreground mt-4 text-sm">
              First 7 Sundays free • No card required • Cancel anytime
            </p>

            {/* Stats */}
            <div className="mx-auto mt-16 grid max-w-3xl grid-cols-2 gap-6 lg:grid-cols-4">
              {HIGHLIGHTS.map((s) => (
                <div key={s.label}>
                  <div className="text-primary text-3xl font-extrabold lg:text-4xl">
                    {s.value}
                  </div>
                  <div className="text-muted-foreground mt-1 text-sm font-medium">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pain points */}
        <section className="py-16 lg:py-24">
          <div className="mx-auto max-w-5xl px-4 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-primary text-sm font-bold uppercase tracking-wider">
                Sound familiar?
              </p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight lg:text-4xl">
                The daily headaches of running a ministry
              </h2>
              <p className="text-muted-foreground mt-4 text-lg">
                If any of these feel like you, you&apos;re not alone — and you
                don&apos;t have to keep doing it the hard way.
              </p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {PAINS.map((p) => (
                <div
                  key={p}
                  className="bg-card rounded-2xl border border-dashed p-5 text-pretty"
                >
                  <p className="text-muted-foreground italic">{p}</p>
                </div>
              ))}
            </div>
            <p className="mt-8 text-center text-lg font-semibold">
              FlockInsight fixes all of this — in one place. 👇
            </p>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="bg-muted/30 border-y py-20 lg:py-28">
          <div className="mx-auto max-w-6xl px-4 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-primary text-sm font-bold uppercase tracking-wider">
                Features
              </p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight lg:text-4xl">
                Everything you need to grow your ministry
              </h2>
              <p className="text-muted-foreground mt-4 text-lg">
                One affordable platform that replaces a dozen tools — simple
                enough for any volunteer to use.
              </p>
            </div>
            <div className="mx-auto mb-10 mt-6 flex max-w-3xl flex-wrap justify-center gap-2">
              {AUDIENCES.map((a) => (
                <span
                  key={a}
                  className="bg-background rounded-full border px-3 py-1 text-sm font-semibold"
                >
                  {a}
                </span>
              ))}
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => {
                const Icon = FEATURE_ICONS[f.icon] ?? BookOpen;
                return (
                  <Card
                    key={f.title}
                    className="transition-shadow hover:shadow-md"
                  >
                    <CardContent>
                      <div className="bg-primary/10 text-primary grid size-12 place-items-center rounded-xl">
                        <Icon className="size-6" />
                      </div>
                      <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
                      <p className="text-muted-foreground mt-2 text-sm">
                        {f.body}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="py-20 lg:py-28">
          <div className="mx-auto max-w-6xl px-4 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-primary text-sm font-bold uppercase tracking-wider">
                Simple Process
              </p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight lg:text-4xl">
                Get Started in Minutes
              </h2>
              <p className="text-muted-foreground mt-4 text-lg">
                No technical expertise required. Set up your church management
                system in three easy steps.
              </p>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {STEPS.map((s) => (
                <div key={s.n} className="text-center">
                  <div className="from-primary mx-auto grid size-16 place-items-center rounded-2xl bg-gradient-to-br to-violet-500 text-2xl font-extrabold text-white shadow-lg">
                    {s.n}
                  </div>
                  <h3 className="mt-5 text-xl font-bold">{s.title}</h3>
                  <p className="text-muted-foreground mt-2">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Built for African churches — every claim checkable in the app */}
        <section
          id="built-for"
          className="bg-muted/30 border-y py-20 lg:py-28"
        >
          <div className="mx-auto max-w-6xl px-4 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-primary text-sm font-bold tracking-wider uppercase">
                Why this one
              </p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight lg:text-4xl">
                Built for how African churches actually work
              </h2>
              <p className="text-muted-foreground mt-4 text-lg">
                Most church software is built for an American congregation with
                office broadband. These are the decisions that make this one
                different — all of them checkable the moment you sign up.
              </p>
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {BUILT_FOR.map((b) => (
                <Card key={b.title}>
                  <CardContent>
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="text-primary mt-0.5 size-5 shrink-0" />
                      <div>
                        <h3 className="font-bold">{b.title}</h3>
                        <p className="text-muted-foreground mt-1.5 text-sm">
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

        {/* Pricing */}
        <section id="pricing" className="bg-muted/30 border-y py-20 lg:py-28">
          <div className="mx-auto max-w-6xl px-4 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-primary text-sm font-bold uppercase tracking-wider">
                Pricing
              </p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight lg:text-4xl">
                Simple pricing for every church
              </h2>
              <p className="text-muted-foreground mt-4 text-lg">
                Start free and grow as your congregation grows. Prices in Naira,
                no card required to begin.
              </p>
            </div>
            <div className="mt-12 grid gap-5 lg:grid-cols-4">
              {plans.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "bg-card relative flex flex-col rounded-3xl border p-6 shadow-sm",
                    p.highlight && "border-primary ring-primary/30 ring-2",
                  )}
                >
                  {p.highlight && (
                    <span className="bg-primary text-primary-foreground absolute -top-3 left-6 rounded-full px-3 py-1 text-xs font-bold">
                      Most popular
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
                          {planPriceLabel(p)}
                        </span>
                        <span className="text-primary ml-2 text-2xl font-extrabold">
                          Free
                        </span>
                        <p className="text-primary mt-0.5 text-xs font-bold uppercase tracking-wide">
                          First 7 Sundays
                        </p>
                      </>
                    ) : (
                      <span className="text-3xl font-extrabold tracking-tight">
                        {planPriceLabel(p)}
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
                      {p.priceMonthly === null ? "Contact us" : "Get started"}
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground mt-8 text-center text-sm">
              See full plan details on the{" "}
              <Link href="/pricing" className="text-primary font-semibold underline">
                pricing page
              </Link>
              .
            </p>
          </div>
        </section>

        {/* FAQ — also emitted as FAQPage structured data */}
        <section id="faq" className="py-20 lg:py-28">
          <div className="mx-auto max-w-3xl px-4 lg:px-8">
            <div className="text-center">
              <p className="text-primary text-sm font-bold tracking-wider uppercase">
                Questions
              </p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight lg:text-4xl">
                Straight answers
              </h2>
            </div>
            <div className="mt-10 divide-y rounded-2xl border">
              {FAQ.map((f) => (
                <details key={f.q} className="group p-5">
                  <summary className="cursor-pointer list-none text-lg font-bold">
                    {f.q}
                  </summary>
                  <p className="text-muted-foreground mt-3 leading-relaxed">
                    {f.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 lg:py-28">
          <div className="mx-auto max-w-4xl px-4 lg:px-8">
            <Card className="from-primary overflow-hidden bg-gradient-to-br to-violet-600 text-center text-white">
              <CardContent className="px-6 py-14">
                <h2 className="text-3xl font-extrabold tracking-tight text-balance lg:text-4xl">
                  Start with this Sunday
                </h2>
                <p className="mx-auto mt-4 max-w-2xl text-lg text-white/85">
                  Set your church up in about half an hour, and record your
                  first Sunday the same week. Seven Sundays free, and your data
                  is yours to take at any time.
                </p>
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <Button asChild size="xl" variant="secondary">
                    <Link href="/signup">
                      Start Free Trial <ArrowRight className="size-5" />
                    </Link>
                  </Button>
                </div>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/85">
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="size-4" /> No credit card required
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="size-4" /> First 7 Sundays free
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-12">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
          <div className="sm:col-span-2 lg:col-span-1">
            <Wordmark />
            <p className="text-muted-foreground mt-3 max-w-xs text-sm">
              Empowering churches with modern management tools to grow and
              thrive.
            </p>
          </div>
          <div>
            <p className="text-sm font-bold">Product</p>
            <ul className="text-muted-foreground mt-3 space-y-2 text-sm">
              <li><a href="#features" className="hover:text-primary">Features</a></li>
              <li><a href="#pricing" className="hover:text-primary">Pricing</a></li>
              <li><Link href="/churches" className="hover:text-primary">Find a church</Link></li>
              <li><Link href="/changelog" className="hover:text-primary">What&apos;s New</Link></li>
              <li><Link href="/roadmap" className="hover:text-primary">Roadmap</Link></li>
              <li><Link href="/signup" className="hover:text-primary">Get Started</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-bold">Company</p>
            <ul className="text-muted-foreground mt-3 space-y-2 text-sm">
              <li><Link href="/blog" className="hover:text-primary">Blog</Link></li>
              <li><a href="mailto:support@flockinsight.com" className="hover:text-primary">Contact</a></li>
              <li><Link href="/changelog" className="hover:text-primary">What&apos;s New</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-bold">Legal</p>
            <ul className="text-muted-foreground mt-3 space-y-2 text-sm">
              <li><Link href="/privacy" className="hover:text-primary">Privacy Policy</Link></li>
              <li><Link href="/terms" className="hover:text-primary">Terms of Service</Link></li>
            </ul>
          </div>
        </div>
        <div className="text-muted-foreground mx-auto mt-10 max-w-6xl px-4 text-center text-sm lg:px-8">
          © {new Date().getFullYear()} Toko Technologies. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
