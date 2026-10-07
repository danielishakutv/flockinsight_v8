"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Phone, Search, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type FirstTimerRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: string;
  firstVisitDate: string | null;
  invitedBy: string | null;
  inFollowUp: boolean;
  followUpStatus: string | null;
};

function fmt(date: string | null): string | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Group by the day they came, because that is how a church thinks about them. */
function groupByVisit(rows: FirstTimerRow[]) {
  const groups = new Map<string, FirstTimerRow[]>();
  for (const r of rows) {
    const key = r.firstVisitDate ?? "unknown";
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.entries()];
}

export function FirstTimersList({ rows }: { rows: FirstTimerRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.phone, r.email, r.invitedBy]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const groups = groupByVisit(filtered);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-12 text-center">
        <UserRound className="text-muted-foreground mx-auto size-8" />
        <p className="mt-3 font-semibold">Nobody registered yet</p>
        <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-sm">
          Use the button above when someone new comes, or turn on the public
          link and let them fill it in themselves. They will appear here and in
          follow-up, and on your members list as before.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative sm:max-w-xs">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-page-search
            placeholder="Search by name, phone or who invited them"
          className="pl-9"
        />
      </div>

      {groups.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-10 text-center text-sm">
          Nobody matches that.
        </p>
      ) : (
        groups.map(([day, people]) => (
          <section key={day}>
            <h2 className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase">
              <CalendarDays className="size-3" />
              {fmt(day) ?? "Date not recorded"} · {people.length}
            </h2>
            <ul className="mt-1 divide-y rounded-xl border">
              {people.map((p) => (
                <li key={p.id}>
                  {/*
                    Straight through to the member's own page, which is where
                    every other part of the app already shows a person. A
                    first-timer is a member row, so there is no second profile
                    to build and nothing to keep in step.
                  */}
                  <Link
                    href={`/members/${p.id}`}
                    className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3 transition"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{p.name}</p>
                      <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                        {p.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="size-3" />
                            {p.phone}
                          </span>
                        )}
                        {p.invitedBy && <span>Invited by {p.invitedBy}</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge
                        variant="secondary"
                        className={cn(
                          p.status === "visitor" &&
                            "bg-sky-500/12 text-sky-700 dark:text-sky-300",
                        )}
                      >
                        {p.status === "visitor"
                          ? "Visitor"
                          : p.status === "new_convert"
                            ? "New convert"
                            : p.status === "active"
                              ? "Member"
                              : p.status}
                      </Badge>
                      {p.inFollowUp && (
                        <span className="text-muted-foreground text-[10px] font-semibold">
                          in follow-up
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
