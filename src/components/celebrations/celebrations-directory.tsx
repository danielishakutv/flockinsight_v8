"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Cake,
  Droplets,
  Heart,
  PartyPopper,
  Search,
  Sparkles,
} from "lucide-react";
import type {
  CelebrationCategory,
  CelebrationListItem,
} from "@/lib/celebrations";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const FILTERS: { key: CelebrationCategory | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "birthday", label: "Birthdays" },
  { key: "wedding", label: "Weddings" },
  { key: "baptism", label: "Baptisms" },
  { key: "other", label: "Other" },
];

function CategoryIcon({ category }: { category: CelebrationCategory }) {
  const cls = "text-primary size-4 shrink-0";
  if (category === "birthday") return <Cake className={cls} />;
  if (category === "wedding") return <Heart className={cls} />;
  if (category === "baptism") return <Droplets className={cls} />;
  return <Sparkles className={cls} />;
}

export function CelebrationsDirectory({
  items,
  days,
}: {
  items: CelebrationListItem[];
  days: number;
}) {
  const [filter, setFilter] = useState<CelebrationCategory | "all">("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[i.category] = (c[i.category] ?? 0) + 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (filter === "all" || i.category === filter) &&
        (!q || i.name.toLowerCase().includes(q)),
    );
  }, [items, filter, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              )}
            >
              {f.label}
              {counts[f.key] ? (
                <span className="ml-1.5 opacity-70">{counts[f.key]}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            className="pl-9"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-2xl border border-dashed py-14 text-center">
          <PartyPopper className="size-8" />
          <p>No celebrations in the next {days} days match this filter.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <Link
              key={c.id}
              href={`/members/${c.memberId}`}
              className="bg-card hover:border-primary/40 flex items-center gap-3 rounded-2xl border p-3 shadow-sm transition-colors"
            >
              <div className="bg-primary/10 grid size-10 shrink-0 place-items-center rounded-xl">
                <CategoryIcon category={c.category} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.name}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {c.occasion}
                  {c.years ? ` · ${c.years} year${c.years === 1 ? "" : "s"}` : ""}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-xs font-bold",
                  c.offset === 0
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {c.dateLabel}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
