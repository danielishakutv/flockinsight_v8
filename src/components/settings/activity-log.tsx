"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  Download,
  Search,
  ShieldAlert,
  UserCog,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AUDIT_MODULE_LABEL,
  describeAction,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  type AuditSeverity,
} from "@/lib/audit-catalog";
import { cn } from "@/lib/utils";

export type ActivityEntry = {
  id: string;
  /** Only set in the platform view, where rows span many churches. */
  churchName?: string | null;
  actorName: string | null;
  actorRole: string | null;
  viaImpersonation: boolean;
  action: string;
  module: string;
  severity: AuditSeverity;
  summary: string;
  targetLabel: string | null;
  meta: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
};

/**
 * The activity log.
 *
 * Read like a diary, not a database dump: each row leads with the sentence
 * saying what happened, and the machine detail — the action key, the changed
 * fields, the address it came from — is one tap underneath. A log nobody can
 * read is a log nobody checks.
 */
export function ActivityLog({
  entries,
  modules,
  actors,
  nextCursor,
  exportHref,
  showChurch,
}: {
  entries: ActivityEntry[];
  modules: string[];
  actors: { id: string; name: string }[];
  nextCursor: string | null;
  exportHref: string;
  /** The platform view names the church each row happened in. */
  showChurch?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    // Any filter change starts a new page — keeping a cursor from the old
    // filter would silently skip the first rows of the new one.
    next.delete("before");
    router.push(`?${next.toString()}`);
  };

  const filtered =
    params.get("module") || params.get("who") || params.get("severity") || params.get("q") ||
    params.get("from") || params.get("to");

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="space-y-3 rounded-xl border p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParam("q", query.trim() || null);
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search what happened, or who did it…"
              className="pl-9"
              aria-label="Search the activity log"
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Filter label="Area">
            <Select
              value={params.get("module") ?? "all"}
              onValueChange={(v) => setParam("module", v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everything</SelectItem>
                {modules.map((m) => (
                  <SelectItem key={m} value={m}>
                    {AUDIT_MODULE_LABEL[m] ?? m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>

          <Filter label="Who">
            <Select value={params.get("who") ?? "all"} onValueChange={(v) => setParam("who", v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent searchPlaceholder="Search people…">
                <SelectItem value="all">Anyone</SelectItem>
                {actors.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>

          <Filter label="From">
            <Input
              type="date"
              value={params.get("from") ?? ""}
              onChange={(e) => setParam("from", e.target.value || null)}
            />
          </Filter>

          <Filter label="To">
            <Input
              type="date"
              value={params.get("to") ?? ""}
              onChange={(e) => setParam("to", e.target.value || null)}
            />
          </Filter>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={params.get("severity") ?? "all"}
            onValueChange={(v) => setParam("severity", v)}
          >
            <SelectTrigger className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entries</SelectItem>
              <SelectItem value="warning">Needs attention</SelectItem>
              <SelectItem value="critical">Sensitive only</SelectItem>
            </SelectContent>
          </Select>

          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("?")}
              className="text-muted-foreground"
            >
              <X className="size-4" /> Clear filters
            </Button>
          )}

          <Button asChild variant="secondary" size="sm" className="ml-auto">
            <a href={exportHref}>
              <Download className="size-4" /> Download CSV
            </a>
          </Button>
        </div>
      </div>

      {/* Entries */}
      {entries.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border py-12 text-center text-sm">
          Nothing matches those filters.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {entries.map((e) => (
            <Entry key={e.id} entry={e} showChurch={showChurch} />
          ))}
        </ol>
      )}

      {nextCursor && (
        <div className="text-center">
          <Button
            variant="secondary"
            onClick={() => {
              const next = new URLSearchParams(params.toString());
              next.set("before", nextCursor);
              router.push(`?${next.toString()}`);
            }}
          >
            Show older <ChevronDown className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-muted-foreground mb-1 block text-xs font-semibold uppercase">
        {label}
      </Label>
      {children}
    </div>
  );
}

function Entry({
  entry,
  showChurch,
}: {
  entry: ActivityEntry;
  showChurch?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const changed = entry.meta?.changed as Record<string, { from: unknown; to: unknown }> | undefined;
  const hasDetail =
    !!entry.ip || !!entry.targetLabel || (entry.meta && Object.keys(entry.meta).length > 0);

  const when = new Date(entry.createdAt);

  return (
    <li className="hover:bg-muted/40 rounded-lg border px-3 py-2.5 transition-colors">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={cn("w-full text-left", !hasDetail && "cursor-default")}
        aria-expanded={hasDetail ? open : undefined}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{entry.summary}</span>
          {entry.severity !== "info" && (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                SEVERITY_TONE[entry.severity],
              )}
            >
              {SEVERITY_LABEL[entry.severity]}
            </span>
          )}
          {entry.viaImpersonation && (
            <span className="flex items-center gap-1 rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 uppercase dark:text-violet-300">
              <ShieldAlert className="size-3" /> FlockInsight support
            </span>
          )}
        </div>

        <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
          <span className="font-medium">{entry.actorName ?? "Someone"}</span>
          {entry.actorRole && <span>· {entry.actorRole}</span>}
          <span>· {AUDIT_MODULE_LABEL[entry.module] ?? entry.module}</span>
          {showChurch && entry.churchName && (
            <span className="text-foreground/70 font-medium">
              · {entry.churchName}
            </span>
          )}
          <span>
            ·{" "}
            <time dateTime={entry.createdAt}>
              {when.toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </span>
          {hasDetail && (
            <ChevronDown
              className={cn("size-3.5 transition-transform", open && "rotate-180")}
            />
          )}
        </p>
      </button>

      {open && (
        <div className="bg-muted/50 mt-2 space-y-2 rounded-lg p-2.5 text-xs">
          <p className="text-muted-foreground">
            <span className="font-semibold">{describeAction(entry.action)}</span>
            <code className="ml-2 opacity-70">{entry.action}</code>
          </p>
          {entry.targetLabel && (
            <p>
              <span className="text-muted-foreground">On: </span>
              {entry.targetLabel}
            </p>
          )}

          {changed && Object.keys(changed).length > 0 && (
            <table className="w-full">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="pb-1 font-semibold">Field</th>
                  <th className="pb-1 font-semibold">Was</th>
                  <th className="pb-1 font-semibold">Now</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(changed).map(([field, v]) => (
                  <tr key={field} className="border-t">
                    <td className="py-1 pr-2 font-medium">{humanField(field)}</td>
                    <td className="text-muted-foreground py-1 pr-2 wrap-anywhere">
                      {render(v.from)}
                    </td>
                    <td className="py-1 wrap-anywhere">{render(v.to)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {entry.ip && (
            <p className="text-muted-foreground flex items-center gap-1.5">
              <UserCog className="size-3.5" /> From {entry.ip}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function humanField(k: string): string {
  return k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

function render(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).slice(0, 200);
}
