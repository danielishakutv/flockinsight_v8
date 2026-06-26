"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock, Search } from "lucide-react";
import type { Guide } from "@/lib/help-guides";
import { helpIcon } from "@/components/help/icons";

export function HelpBrowser({
  guides,
  categories,
}: {
  guides: Guide[];
  categories: { key: string; title: string }[];
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return guides;
    return guides.filter((g) =>
      [g.title, g.summary, ...(g.keywords ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [q, guides]);

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="text-muted-foreground absolute left-3 top-1/2 size-5 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search guides… (e.g. SMS, reminders, members)"
          className="bg-background h-12 w-full rounded-xl border pl-11 pr-4 text-base shadow-sm outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          No guides match “{q}”. Try another word, or contact support.
        </p>
      ) : (
        categories.map((cat) => {
          const items = filtered.filter((g) => g.category === cat.key);
          if (items.length === 0) return null;
          return (
            <section key={cat.key}>
              <h2 className="text-muted-foreground mb-2 text-xs font-bold uppercase tracking-wide">
                {cat.title}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((g) => {
                  const Icon = helpIcon(g.icon);
                  return (
                    <Link
                      key={g.slug}
                      href={`/help/${g.slug}`}
                      className="group bg-card flex gap-3 rounded-2xl border p-4 shadow-sm transition hover:shadow-md"
                    >
                      <div className="bg-primary/10 text-primary grid size-11 shrink-0 place-items-center rounded-xl">
                        <Icon className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="group-hover:text-primary font-bold leading-tight">
                          {g.title}
                        </p>
                        <p className="text-muted-foreground mt-0.5 line-clamp-2 text-sm">
                          {g.summary}
                        </p>
                        <p className="text-muted-foreground mt-1.5 flex items-center gap-1 text-xs">
                          <Clock className="size-3" /> {g.minutes} min read
                        </p>
                      </div>
                      <ArrowRight className="text-muted-foreground size-4 shrink-0 self-center transition group-hover:translate-x-0.5" />
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
