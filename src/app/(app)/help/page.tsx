import Link from "next/link";
import { ArrowRight, BookOpen, MessageCircle } from "lucide-react";
import { GUIDES, GUIDE_CATEGORIES } from "@/lib/help-guides";
import { HelpBrowser } from "@/components/help/help-browser";

export const metadata = { title: "Help & Support" };

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
          Help & Support
        </h1>
        <p className="text-muted-foreground mt-1">
          Step-by-step guides for everything in FlockInsight — and a direct line
          to our team.
        </p>
      </div>

      {/* Quick actions */}
      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <Link
          href="/help/support"
          className="from-primary group flex items-center gap-4 rounded-2xl bg-gradient-to-br to-violet-600 p-5 text-white shadow-sm transition hover:shadow-md"
        >
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/20">
            <MessageCircle className="size-6" />
          </div>
          <div className="flex-1">
            <p className="font-bold">Contact us</p>
            <p className="text-sm text-white/85">
              Open a support ticket — we&apos;ll reply by email.
            </p>
          </div>
          <ArrowRight className="size-5 transition group-hover:translate-x-0.5" />
        </Link>
        <Link
          href="/help/getting-started"
          className="bg-card group flex items-center gap-4 rounded-2xl border p-5 shadow-sm transition hover:shadow-md"
        >
          <div className="bg-primary/10 text-primary grid size-12 shrink-0 place-items-center rounded-xl">
            <BookOpen className="size-6" />
          </div>
          <div className="flex-1">
            <p className="group-hover:text-primary font-bold">New here? Start here</p>
            <p className="text-muted-foreground text-sm">
              Set up your church in 10 minutes.
            </p>
          </div>
          <ArrowRight className="text-muted-foreground size-5 transition group-hover:translate-x-0.5" />
        </Link>
      </div>

      <HelpBrowser guides={GUIDES} categories={GUIDE_CATEGORIES} />
    </div>
  );
}
