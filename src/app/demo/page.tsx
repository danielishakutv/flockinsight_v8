import Link from "next/link";
import { CalendarCheck, MessageCircle, PhoneCall, Sparkles } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { DemoRequestForm } from "@/components/public/demo-request-form";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Book a free walkthrough",
  description:
    "See FlockInsight on your own church's data in 20 minutes. We set it up with you — attendance, members, giving, SMS and follow-up. First 7 Sundays free.",
};

const POINTS = [
  {
    icon: PhoneCall,
    title: "A 20-minute call",
    body: "On WhatsApp or phone, whenever suits you — including after service on Sunday.",
  },
  {
    icon: CalendarCheck,
    title: "We set it up with you",
    body: "Your services, your members list, your giving categories. You finish the call with a working church account.",
  },
  {
    icon: Sparkles,
    title: "First 7 Sundays free",
    body: "No card. If it doesn't save your team time by then, walk away.",
  },
];

export default function DemoPage() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 lg:px-8">
        <Link href="/">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/pricing">Pricing</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">Start free</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-16">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-balance lg:text-5xl">
            See it on your church&rsquo;s own numbers
          </h1>
          <p className="text-muted-foreground mt-5 text-lg">
            Tell us about your church and we&rsquo;ll walk you through
            FlockInsight — attendance, members, giving, SMS and follow-up — using
            your services and your people, not a demo account.
          </p>

          <ul className="mt-8 space-y-5">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-4">
                <div className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
                  <p.icon className="size-5" />
                </div>
                <div>
                  <p className="font-bold">{p.title}</p>
                  <p className="text-muted-foreground text-sm">{p.body}</p>
                </div>
              </li>
            ))}
          </ul>

          <a
            href="https://wa.me/2348088256055"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary mt-8 inline-flex items-center gap-2 text-sm font-semibold"
          >
            <MessageCircle className="size-4" /> Or message us on WhatsApp
          </a>
        </div>

        <DemoRequestForm />
      </main>
    </div>
  );
}
