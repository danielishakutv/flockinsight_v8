import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  HandCoins,
  MessageSquare,
  ShieldCheck,
  Star,
  Users,
} from "lucide-react";
import { getSession } from "@/lib/session";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = {
  title: "FlockInsight — Modern Church Management",
  description:
    "Streamline operations, engage your congregation, and grow your ministry with the all-in-one church management platform built for the modern church.",
};

const stats = [
  { value: "5,000+", label: "Churches" },
  { value: "500K+", label: "Members Managed" },
  { value: "99.9%", label: "Uptime" },
  { value: "24/7", label: "Support" },
];

const features = [
  {
    icon: Users,
    title: "Member Management",
    body: "Keep track of your congregation with detailed member profiles, attendance tracking, and engagement insights.",
  },
  {
    icon: Calendar,
    title: "Event Planning",
    body: "Schedule and manage church events, services, and programs with automated reminders and RSVP tracking.",
  },
  {
    icon: HandCoins,
    title: "Donation Tracking",
    body: "Streamline tithes, offerings, and special contributions with secure payment processing and transparent reporting.",
  },
  {
    icon: MessageSquare,
    title: "Communication Tools",
    body: "Send announcements, newsletters, and prayer updates via SMS, email, or in-app notifications.",
  },
  {
    icon: BarChart3,
    title: "Analytics & Reports",
    body: "Make data-driven decisions with comprehensive dashboards and customizable reports on all church activities.",
  },
  {
    icon: ShieldCheck,
    title: "Secure & Reliable",
    body: "Enterprise-grade security with data encryption, regular backups, and 99.9% uptime guarantee.",
  },
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
  const session = await getSession();
  const loggedIn = !!session?.user;

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Header */}
      <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 lg:px-8">
          <Wordmark />
          <nav className="hidden items-center gap-8 text-sm font-semibold md:flex">
            <a href="#features" className="hover:text-primary">Features</a>
            <a href="#how" className="hover:text-primary">How It Works</a>
            <a href="#testimonials" className="hover:text-primary">Testimonials</a>
            <a href="#pricing" className="hover:text-primary">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            {loggedIn ? (
              <Button asChild>
                <Link href="/dashboard">
                  Dashboard <ArrowRight className="size-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" className="max-sm:hidden">
                  <Link href="/login">Login</Link>
                </Button>
                <Button asChild>
                  <Link href="/signup">Get Started</Link>
                </Button>
              </>
            )}
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
              Trusted by 5,000+ Churches Worldwide
            </span>
            <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Empower Your Church with{" "}
              <span className="text-primary">Modern Management</span>
            </h1>
            <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg text-balance">
              Streamline operations, engage your congregation, and grow your
              ministry with the all-in-one church management platform built for
              the modern church.
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

        {/* Features */}
        <section id="features" className="bg-muted/30 border-y py-20 lg:py-28">
          <div className="mx-auto max-w-6xl px-4 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-primary text-sm font-bold uppercase tracking-wider">
                Features
              </p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight lg:text-4xl">
                Everything You Need to Manage Your Church
              </h2>
              <p className="text-muted-foreground mt-4 text-lg">
                Powerful features designed to simplify church administration and
                strengthen your community.
              </p>
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

        {/* Pricing / CTA */}
        <section id="pricing" className="py-20 lg:py-28">
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
              <li><span>Privacy Policy</span></li>
              <li><span>Terms of Service</span></li>
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
