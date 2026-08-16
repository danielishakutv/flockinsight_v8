"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, Loader2, Phone, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { bulkUpdateLeads } from "@/app/superadmin/growth/actions";
import {
  LEAD_STATUSES,
  followUpLabel,
  leadStatusMeta,
  type LeadStatus,
} from "@/lib/growth-shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type LeadListRow = {
  id: string;
  churchName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  size: number | null;
  status: LeadStatus;
  source: string;
  nextFollowUpAt: string | null;
  lastContactedAt: string | null;
  createdAt: string;
};

const TABS: { id: string; label: string }[] = [
  { id: "due", label: "Due now" },
  { id: "open", label: "Open" },
  { id: "new", label: "New" },
  { id: "interested", label: "Interested" },
  { id: "demo", label: "Demo" },
  { id: "trial", label: "Trialling" },
  { id: "converted", label: "Converted" },
  { id: "lost", label: "Lost" },
  { id: "all", label: "Everyone" },
];

const ALL_SOURCES = "__all__";

export function LeadsTable({
  rows,
  count,
  page,
  pageSize,
  status,
  source,
  q,
  sources,
}: {
  rows: LeadListRow[];
  count: number;
  page: number;
  pageSize: number;
  status: string;
  source: string;
  q: string;
  sources: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [term, setTerm] = useState(q);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Keep the box in step when the URL changes under us (filter chips, back).
  const [lastQ, setLastQ] = useState(q);
  if (lastQ !== q) {
    setLastQ(q);
    setTerm(q);
  }

  function go(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    if (!("page" in next)) sp.delete("page");
    router.push(`/superadmin/growth?${sp.toString()}`);
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function bulk(change: { status?: LeadStatus; nextFollowUpAt?: string | null }) {
    const ids = [...picked];
    if (ids.length === 0) return;
    startTransition(async () => {
      const res = await bulkUpdateLeads({ ids, ...change });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Updated ${ids.length} lead${ids.length === 1 ? "" : "s"}.`);
      setPicked(new Set());
      router.refresh();
    });
  }

  const pages = Math.max(1, Math.ceil(count / pageSize));
  const inDays = (n: number) =>
    new Date(Date.now() + n * 86_400_000).toISOString();

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => go({ status: t.id })}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                status === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form
            className="relative min-w-56 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              go({ q: term.trim() || null });
            }}
          >
            <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search church, person, phone, city…"
              className="pl-9"
            />
          </form>
          <Select
            value={source === "all" ? ALL_SOURCES : source}
            onValueChange={(v) => go({ source: v === ALL_SOURCES ? null : v })}
          >
            <SelectTrigger className="w-48" aria-label="Source">
              <SelectValue placeholder="Any source" />
            </SelectTrigger>
            <SelectContent searchPlaceholder="Search sources…">
              <SelectItem value={ALL_SOURCES}>Any source</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-sm">
            {count} lead{count === 1 ? "" : "s"}
          </p>
        </div>

        {/* Bulk bar */}
        {picked.size > 0 && (
          <div className="bg-accent/50 flex flex-wrap items-center gap-2 rounded-xl border p-2.5">
            <span className="text-sm font-semibold">
              {picked.size} selected
            </span>
            <Select onValueChange={(v) => bulk({ status: v as LeadStatus })}>
              <SelectTrigger size="sm" className="w-44" aria-label="Set status">
                <SelectValue placeholder="Set status…" />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => bulk({ nextFollowUpAt: inDays(2) })}
            >
              <CalendarClock className="size-4" /> Follow up in 2 days
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => bulk({ nextFollowUpAt: inDays(7) })}
            >
              Next week
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
              Clear
            </Button>
            {pending && <Loader2 className="size-4 animate-spin" />}
          </div>
        )}

        {/* Rows */}
        {rows.length === 0 ? (
          <div className="text-muted-foreground py-12 text-center">
            <Users className="mx-auto mb-2 size-8 opacity-40" />
            <p className="font-medium">Nothing here yet</p>
            <p className="text-sm">
              Add a church you&rsquo;ve spoken to, or import a list.
            </p>
          </div>
        ) : (
          <div className="divide-y rounded-xl border">
            {rows.map((r) => {
              const meta = leadStatusMeta(r.status);
              const due = followUpLabel(r.nextFollowUpAt);
              return (
                <div
                  key={r.id}
                  className="hover:bg-accent/30 flex items-start gap-3 p-3 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={picked.has(r.id)}
                    onChange={() => toggle(r.id)}
                    aria-label={`Select ${r.churchName}`}
                    className="accent-primary mt-1.5 size-4 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/superadmin/growth/${r.id}`}
                        className="hover:text-primary font-semibold"
                      >
                        {r.churchName}
                      </Link>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-bold",
                          meta.tone,
                        )}
                      >
                        {meta.label}
                      </span>
                      {due && (
                        <span
                          className={cn(
                            "text-xs font-semibold",
                            due.overdue
                              ? "text-destructive"
                              : due.dueToday
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground",
                          )}
                        >
                          {due.text}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5 truncate text-sm">
                      {[
                        r.contactName,
                        r.phone,
                        r.email,
                        [r.city, r.state].filter(Boolean).join(", "),
                        r.size ? `${r.size} members` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {r.phone && (
                      <Button size="sm" variant="ghost" asChild>
                        <a href={`tel:${r.phone}`} aria-label="Call">
                          <Phone className="size-4" />
                        </a>
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" asChild>
                      <Link href={`/superadmin/growth/${r.id}`}>Open</Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => go({ page: String(page - 1) })}
            >
              Previous
            </Button>
            <span className="text-muted-foreground text-sm">
              Page {page} of {pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages}
              onClick={() => go({ page: String(page + 1) })}
            >
              Next
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
