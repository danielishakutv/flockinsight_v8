"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import {
  RECIPIENT_STATUS_FILTERS,
  type RecipientStatusFilter,
} from "@/lib/comm-message-shared";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * Status tabs + name/number search for one message's recipient list. Like the
 * history screen, state lives in the URL so the page stays a server component.
 */
export function RecipientFilters({
  messageId,
  status,
  q,
  counts,
}: {
  messageId: string;
  status: RecipientStatusFilter;
  q: string;
  counts: {
    all: number;
    sent: number;
    delivered: number;
    failed: number;
    skipped: number;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(q);
  const [lastQ, setLastQ] = useState(q);

  // Keep the box in step when the URL changes from elsewhere (e.g. Back).
  if (q !== lastQ) {
    setLastQ(q);
    setText(q);
  }

  function go(next: { status?: RecipientStatusFilter; q?: string }) {
    const p = new URLSearchParams();
    const s = next.status ?? status;
    const search = next.q ?? text;
    if (s !== "all") p.set("status", s);
    if (search.trim()) p.set("q", search.trim());
    const qs = p.toString();
    start(() =>
      router.push(`/communication/history/${messageId}${qs ? `?${qs}` : ""}`),
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {RECIPIENT_STATUS_FILTERS.map((s) => {
          const n = counts[s.id];
          return (
            <button
              key={s.id}
              onClick={() => go({ status: s.id })}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
                status === s.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:bg-accent",
                // Nothing in this bucket — keep it visible but recede it.
                n === 0 && status !== s.id && "text-muted-foreground",
              )}
            >
              {s.label}
              <span className="tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          go({});
        }}
      >
        {pending ? (
          <Loader2 className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin" />
        ) : (
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        )}
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search a name, phone number or email"
          className="pl-9"
          aria-label="Search recipients"
        />
        {text && (
          <button
            type="button"
            onClick={() => {
              setText("");
              go({ q: "" });
            }}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        )}
      </form>
    </div>
  );
}
