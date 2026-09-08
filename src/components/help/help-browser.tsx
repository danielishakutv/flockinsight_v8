"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock, Search } from "lucide-react";
import { sectionBlocks, type Guide } from "@/lib/help-guides";
import { helpIcon } from "@/components/help/icons";

export function HelpBrowser({
  guides,
  categories,
}: {
  guides: Guide[];
  categories: { key: string; title: string }[];
}) {
  const [q, setQ] = useState("");

  /**
   * Everything in a guide, flattened once into one searchable string.
   *
   * Searching only titles and keywords means someone typing the words they
   * actually have — "sender id rejected", "why did my SMS fail" — finds
   * nothing, even though a guide answers it in as many words. Built once per
   * guide list rather than per keystroke.
   */
  const haystacks = useMemo(
    () =>
      new Map(
        guides.map((g) => {
          const parts: string[] = [g.title, g.summary, ...(g.keywords ?? [])];
          for (const w of g.whoFor ?? []) parts.push(w);
          for (const s of g.sections) {
            if (s.title) parts.push(s.title);
            for (const b of sectionBlocks(s)) {
              switch (b.kind) {
                case "text":
                case "note":
                case "warning":
                  parts.push(b.text);
                  break;
                case "bullets":
                  parts.push(b.items.join(" "));
                  break;
                case "steps":
                  parts.push(
                    b.items.map((i) => `${i.title} ${i.detail ?? ""}`).join(" "),
                  );
                  break;
                case "example":
                  parts.push(b.title, b.lines.join(" "));
                  break;
                case "table":
                  parts.push([...b.headers, ...b.rows.flat()].join(" "));
                  break;
              }
            }
          }
          for (const f of g.faq ?? []) parts.push(f.q, f.a);
          return [g.slug, parts.join(" ").toLowerCase()];
        }),
      ),
    [guides],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return guides;
    // Every word has to appear somewhere, so "sms sender" narrows rather than
    // widening the way a single-substring match would.
    const words = term.split(/\s+/);
    return guides.filter((g) => {
      const hay = haystacks.get(g.slug) ?? "";
      return words.every((w) => hay.includes(w));
    });
  }, [q, guides, haystacks]);

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
