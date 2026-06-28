"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Search, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type AuditEntry = {
  id: string;
  actorName: string | null;
  action: string;
  summary: string;
  targetType: string | null;
  createdAt: string;
};

export function AuditList({ entries }: { entries: AuditEntry[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      [e.actorName ?? "", e.action, e.summary, e.targetType ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [entries, query]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by admin, action or detail"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="text-muted-foreground py-10 text-center">
            No matching activity.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => (
            <div
              key={e.id}
              className="bg-card flex items-start gap-3 rounded-xl border p-3"
            >
              <div className="bg-primary/10 text-primary mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg">
                <ShieldCheck className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{e.summary}</p>
                <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <span>{e.actorName ?? "Unknown admin"}</span>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {e.action}
                  </Badge>
                  <span>·</span>
                  <span>{format(parseISO(e.createdAt), "MMM d, yyyy · h:mm a")}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
