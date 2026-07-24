"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import {
  HISTORY_CHANNELS,
  HISTORY_RANGES,
  type ChannelId,
  type RangeId,
} from "@/lib/comm-history-shared";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Channel / date-range / search controls. Filters live in the URL so the page
 * stays a server component and every view is shareable and bookmarkable.
 */
export function HistoryFilters({
  channel,
  range,
  q,
}: {
  channel: ChannelId;
  range: RangeId;
  q: string;
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

  function go(next: { channel?: ChannelId; range?: RangeId; q?: string }) {
    const p = new URLSearchParams();
    const c = next.channel ?? channel;
    const r = next.range ?? range;
    const search = next.q ?? text;
    if (c !== "all") p.set("channel", c);
    if (r !== "30") p.set("range", r);
    if (search.trim()) p.set("q", search.trim());
    const qs = p.toString();
    start(() => router.push(`/communication/history${qs ? `?${qs}` : ""}`));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {HISTORY_CHANNELS.map((c) => (
          <button
            key={c.id}
            onClick={() => go({ channel: c.id })}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
              channel === c.id
                ? "border-primary bg-primary/10 text-primary"
                : "hover:bg-accent",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <form
          className="relative flex-1"
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
            placeholder="Search message, subject or audience"
            className="pl-9"
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

        <Select value={range} onValueChange={(v) => go({ range: v as RangeId })}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HISTORY_RANGES.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
