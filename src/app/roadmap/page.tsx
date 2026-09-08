import Link from "next/link";
import { ArrowLeft, CircleDashed, Hammer, Rocket } from "lucide-react";
import { format } from "date-fns";
import { Wordmark } from "@/components/brand";
import { roadmapFeed } from "@/lib/roadmap";

export const metadata = {
  title: "Roadmap",
  description: "What we're building next for FlockInsight, and what's already live.",
};

/** Reflects the board as soon as an item is ticked public. */
export const dynamic = "force-dynamic";

const SECTIONS = [
  {
    key: "in_progress",
    title: "Building now",
    blurb: "Work in progress.",
    icon: Hammer,
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  {
    key: "planned",
    title: "Next up",
    blurb: "Committed, and waiting its turn.",
    icon: CircleDashed,
    className: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  {
    key: "shipped",
    title: "Shipped",
    blurb: "Live for every church.",
    icon: Rocket,
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
] as const;

export default async function PublicRoadmapPage() {
  // The public feed — items a human ticked as public, and never any metrics.
  const items = await roadmapFeed(false);

  const sections = SECTIONS.map((s) => ({
    ...s,
    items: items.filter((i) => i.status === s.key),
  })).filter((s) => s.items.length > 0);

  return (
    <div className="min-h-dvh">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4">
          <Link href="/">
            <Wordmark logoClassName="size-8" className="text-lg" />
          </Link>
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
          >
            <ArrowLeft className="size-4" /> Home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10 lg:py-16">
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
          Roadmap
        </h1>
        <p className="text-muted-foreground mt-2">
          What we&rsquo;re building for churches next, and what&rsquo;s already
          live. Dates are intentions, not promises.
        </p>

        {sections.length === 0 ? (
          <p className="text-muted-foreground mt-12 rounded-xl border border-dashed px-4 py-12 text-center text-sm">
            Nothing published here yet. Keep an eye on{" "}
            <Link href="/changelog" className="text-primary font-semibold">
              What&rsquo;s New
            </Link>{" "}
            in the meantime.
          </p>
        ) : (
          <div className="mt-12 space-y-12">
            {sections.map((section) => (
              <section key={section.key}>
                <div className="flex items-center gap-2.5">
                  <span
                    className={`grid size-8 place-items-center rounded-lg ${section.className}`}
                  >
                    <section.icon className="size-4" />
                  </span>
                  <div>
                    <h2 className="text-lg font-extrabold tracking-tight">
                      {section.title}
                    </h2>
                    <p className="text-muted-foreground text-xs">
                      {section.blurb}
                    </p>
                  </div>
                </div>

                <ul className="mt-4 space-y-2.5">
                  {section.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border px-4 py-3"
                    >
                      <span className="font-semibold">{item.title}</span>
                      {item.area && (
                        <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px] font-semibold">
                          {item.area}
                        </span>
                      )}
                      {item.shippedAt && (
                        <span className="text-muted-foreground ml-auto text-xs">
                          {format(new Date(item.shippedAt), "MMM yyyy")}
                          {item.version && ` · v${item.version}`}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <p className="text-muted-foreground mt-14 text-sm">
          Want something that isn&rsquo;t here?{" "}
          <Link href="/help/support" className="text-primary font-semibold">
            Tell us
          </Link>{" "}
          — churches asking is how most of this list got written.
        </p>
      </main>
    </div>
  );
}
