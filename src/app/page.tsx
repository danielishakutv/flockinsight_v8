import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  Globe,
  HandCoins,
  HeartHandshake,
  MessageSquare,
  PartyPopper,
  Star,
  Users,
} from "lucide-react";
import { Wordmark } from "@/components/brand";
import { LandingHeaderAuth } from "@/components/landing-header-auth";
import { JsonLd } from "@/components/seo/json-ld";
import { siteUrl } from "@/lib/site";
import { getPlans } from "@/lib/pricing";
import { planPriceLabel } from "@/lib/plans";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "FlockInsight — Church, Fellowship & Ministry Management",
  description:
    "Attendance, members, giving, follow-up, bulk SMS & email, automatic reminders, birthdays, events and your own public page — the all-in-one platform for churches, fellowships and ministries. Built for Africa. Start free.",
};

const stats = [
  { value: "5,000+", label: "Churches" },
  { value: "500K+", label: "Members Managed" },
  { value: "99.9%", label: "Uptime" },
  { value: "24/7", label: "Support" },
];

const pains = [
  "“I have no idea how many people actually came last Sunday — or last month.”",
  "“Our members’ details are scattered across notebooks, phones and three different WhatsApp groups.”",
  "“First-timers visit once and we never follow up — they just disappear.”",
  "“Counting and tracking giving by hand takes hours and still doesn’t add up.”",
  "“We forget members’ birthdays, and reminding everyone about service is a manual chore.”",
  "“We have no simple, shareable page to invite people or be found online.”",
];

const features = [
  {
    icon: Users,
    title: "Members & groups",
    body: "One clean directory for your whole congregation — profiles, families, ministries, departments and cells. Import from a spreadsheet in minutes.",
  },
  {
    icon: BarChart3,
    title: "Attendance & analytics",
    body: "Take fast headcounts in seconds and instantly see growth trends, averages and breakdowns. Know exactly how you’re doing.",
  },
  {
    icon: HandCoins,
    title: "Giving tracking",
    body: "Record tithes, offerings and donations by category. Clear totals and reports — no more guesswork or messy spreadsheets.",
  },
  {
    icon: HeartHandshake,
    title: "Visitor follow-up",
    body: "Never lose a first-timer again. Track visitors through stages, log every call and visit, and assign care to your team.",
  },
  {
    icon: MessageSquare,
    title: "Bulk SMS & email",
    body: "Reach everyone — or a single group — with your own SMS sender ID and free email. Templates make it effortless.",
  },
  {
    icon: Bell,
    title: "Automatic service reminders",
    body: "Set it once and members get reminded about every service by SMS or email, automatically, in your timezone.",
  },
  {
    icon: PartyPopper,
    title: "Birthday & anniversary wishes",
    body: "Make members feel loved — automatic birthday and anniversary messages with your own words. They’ll never forget your church.",
  },
  {
    icon: CalendarDays,
    title: "Events with flyers",
    body: "Publish programs with flyers, dates and venues, and let people discover what’s on near them.",
  },
  {
    icon: Globe,
    title: "Your own public page",
    body: "A beautiful, shareable page (flockinsight.com/c/yourchurch) so members invite people and seekers find you in the directory.",
  },
];

const audiences = [
  "Local churches",
  "Campus & student fellowships",
  "House fellowships & cell groups",
  "Ministries & outreaches",
  "Multi-branch denominations",
];

const steps = [
  {
    n: 1,
    title: "Create Account",
    body: "Sign up in seconds with your church details and preferences.",
  },
  {
    n: 2,
    title: "Add Your Services",
    body: "Set up your services and import or add your members.",
  },
  {
    n: 3,
    title: "Start Managing",
    body: "Begin using all features immediately with our intuitive dashboard.",
  },
];

const testimonials = [
  {
    quote:
      "FlockInsight transformed how we manage our church. Member engagement is up 40% and administration time is cut in half!",
    name: "Pastor John Adeyemi",
    church: "Grace Chapel, Lagos",
  },
  {
    quote:
      "The donation tracking feature alone paid for itself. Our giving increased by 35% with transparent, easy-to-use tools.",
    name: "Rev. Sarah Okafor",
    church: "Faith Community Church, Abuja",
  },
  {
    quote:
      "Communication has never been easier. We reach our entire congregation instantly with targeted messages and updates.",
    name: "Pastor David Nwosu",
    church: "Living Word Ministry, Port Harcourt",
  },
];

export default async function LandingPage() {
  const site = siteUrl();
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "FlockInsight",
      url: site,
      logo: `${site}/icon-512`,
      description:
        "Church management software for attendance, members, groups, giving, communication and more — built for Africa.",
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "FlockInsight",
      url: site,
      potentialAction: {
        "@type": "SearchAction",
        target: `${site}/churches?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "FlockInsight",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, iOS, Android",
      offers: { "@type": "Offer", price: "0", priceCurrency: "NGN" },
      description:
        "All-in-one church management: attendance, members, giving, follow-up, communication, devotionals, forms and a public church page.",
    },
  ];
  const plans = await getPlans();
  return (
    <div className="flex min-h-dvh flex-col">
      <JsonLd data={jsonLd} />
      {/* Header */}
      <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 lg:px-8">
          <Wordmark />
          <nav className="hidden items-center gap-8 text-sm font-semibold md:flex">
            <a href="#features" className="hover:text-primary">Features</a>
            <a href="#how" className="hover:text-primary">How It Works</a>
            <a href="#pricing" className="hover:text-primary">Pricing</a>
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
              Stop juggling notebooks, spreadsheets and WhatsApp groups. Track
              attendance, members, giving and follow-up, send SMS & email,
              automate reminders and birthdays, publish events, and get your own
              shareable page — all in one place, built for Africa.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="xl">
                <Link href="/signup">
                  Create Free Account <ArrowRight className="size-5" />
                </Link>
              </Button>
              <Button asChild size="xl" variant="outline">
                <Link href="/login">Login to Dashboard</Link>
              </Button>
            </div>
            <p className="text-muted-foreground mt-4 text-sm">
              Free 30-day trial • No credit card required • Cancel anytime
            </p>

            {/* Stats */}
            <div className="mx-auto mt-16 grid max-w-3xl grid-cols-2 gap-6 lg:grid-cols-4">
              {stats.map((s) => (
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
              {pains.map((p) => (
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
              {audiences.map((a) => (
                <span
                  key={a}
                  className="bg-background rounded-full border px-3 py-1 text-sm font-semibold"
                >
                  {a}
                </span>
              ))}
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <Card key={f.title} className="transition-shadow hover:shadow-md">
                  <CardContent>
                    <div className="bg-primary/10 text-primary grid size-12 place-items-center rounded-xl">
                      <f.icon className="size-6" />
                    </div>
                    <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
                    <p className="text-muted-foreground mt-2 text-sm">
                      {f.body}
                    </p>
                  </CardContent>
                </Card>
              ))}
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
              {steps.map((s) => (
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

        {/* Testimonials */}
        <section
          id="testimonials"
          className="bg-muted/30 border-y py-20 lg:py-28"
        >
          <div className="mx-auto max-w-6xl px-4 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-primary text-sm font-bold uppercase tracking-wider">
                Testimonials
              </p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight lg:text-4xl">
                Loved by Church Leaders
              </h2>
              <p className="text-muted-foreground mt-4 text-lg">
                See what pastors and administrators are saying about FlockInsight.
              </p>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {testimonials.map((t) => (
                <Card key={t.name}>
                  <CardContent className="flex h-full flex-col">
                    <div className="flex gap-0.5 text-amber-400">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className="size-4 fill-current" />
                      ))}
                    </div>
                    <p className="mt-4 flex-1 text-pretty">“{t.quote}”</p>
                    <div className="mt-6">
                      <p className="font-bold">{t.name}</p>
                      <p className="text-muted-foreground text-sm">{t.church}</p>
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
                  <p className="mt-4 text-3xl font-extrabold tracking-tight">
                    {planPriceLabel(p)}
                  </p>
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

        {/* CTA */}
        <section className="py-20 lg:py-28">
          <div className="mx-auto max-w-4xl px-4 lg:px-8">
            <Card className="from-primary overflow-hidden bg-gradient-to-br to-violet-600 text-center text-white">
              <CardContent className="px-6 py-14">
                <h2 className="text-3xl font-extrabold tracking-tight text-balance lg:text-4xl">
                  Ready to Transform Your Church Management?
                </h2>
                <p className="mx-auto mt-4 max-w-2xl text-lg text-white/85">
                  Join thousands of churches already using FlockInsight to
                  streamline operations and grow their ministry.
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
                    <CheckCircle2 className="size-4" /> 30-day free trial
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
              <li><Link href="/signup" className="hover:text-primary">Get Started</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-bold">Company</p>
            <ul className="text-muted-foreground mt-3 space-y-2 text-sm">
              <li><span>About Us</span></li>
              <li><span>Contact</span></li>
              <li><span>Blog</span></li>
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
