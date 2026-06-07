import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Wordmark } from "@/components/brand";
import {
  CATEGORY_ORDER,
  releases,
  type ChangeCategory,
} from "@/lib/changelog";

export const metadata = {
  title: "What's New",
  description: "Every update to FlockInsight, newest first.",
};

const CATEGORY_STYLES: Record<ChangeCategory, string> = {
  Added: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  Improved: "bg-primary/10 text-primary",
  Fixed: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  Changed: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  Security: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

export default function ChangelogPage() {
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
          What&apos;s New
        </h1>
        <p className="text-muted-foreground mt-2">
          Every update to FlockInsight, newest first.
        </p>

        <div className="mt-12 space-y-14">
          {releases.map((r) => (
            <section key={r.version} className="scroll-mt-20" id={`v${r.version}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="bg-primary/10 text-primary rounded-full px-2.5 py-0.5 font-mono text-sm font-bold">
                  v{r.version}
                </span>
                <time
                  dateTime={r.date}
                  className="text-muted-foreground text-sm"
                >
                  {format(parseISO(r.date), "MMMM d, yyyy")}
                </time>
              </div>

              {r.summary && (
                <p className="mt-3 text-lg font-semibold">{r.summary}</p>
              )}

              <div className="mt-5 space-y-5">
                {CATEGORY_ORDER.filter((c) => r.changes[c]?.length).map((c) => (
                  <div key={c}>
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${CATEGORY_STYLES[c]}`}
                    >
                      {c}
                    </span>
                    <ul className="mt-2.5 space-y-2">
                      {r.changes[c]!.map((item, i) => (
                        <li
                          key={i}
                          className="text-muted-foreground flex gap-2.5 text-[15px] leading-relaxed"
                        >
                          <span
                            aria-hidden
                            className="bg-muted-foreground/40 mt-2 size-1.5 shrink-0 rounded-full"
                          />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="text-muted-foreground mt-16 border-t pt-6 text-sm">
          Built by Toko Technologies. Have a suggestion?{" "}
          <a
            href="mailto:support@flockinsight.com"
            className="text-primary font-medium hover:underline"
          >
            Let us know
          </a>
          .
        </p>
      </main>
    </div>
  );
}
