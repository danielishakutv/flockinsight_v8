"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Slot } from "@/lib/pastoral-slots";

export type SlotPage =
  | { ok: true; zone: string; slots: Slot[]; nextFromDay: string }
  | { ok: false; error: string };

/**
 * Days as a row of chips, times as a grid, fourteen days at a time.
 *
 * Shared by the public page, the manage link and the staff dialogs; only
 * `load` differs. Times are always shown in the CHURCH's zone (and said to
 * be), never the phone's: a visitor from Accra booking a pastor in Lagos
 * must see the time the pastor will be sitting there.
 *
 * Bump `reloadKey` to fetch the same window again, which is how a "that time
 * has just been taken" answer refreshes the list in place.
 */
export function SlotPicker({
  load,
  initialFromDay,
  value,
  onChange,
  emptyText,
  reloadKey = 0,
}: {
  load: (fromDay: string) => Promise<SlotPage>;
  initialFromDay: string;
  value: string | null;
  onChange: (startsAt: string | null) => void;
  emptyText: string;
  reloadKey?: number;
}) {
  const t = useT();
  const [fromDay, setFromDay] = useState(initialFromDay);
  const [history, setHistory] = useState<string[]>([]);
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; page: SlotPage } | null>(null);
  const [day, setDay] = useState<string | null>(null);

  /*
   * The latest `load`, read through a ref. Callers pass an inline arrow, a
   * new function every render, and depending on it directly would refetch on
   * every render, forever.
   */
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  /*
   * One request per (window, reload, retry). "Loading" is simply "the answer
   * on hand is for a different request", so nothing is set synchronously in
   * the effect, and a slow answer for a window already left is dropped.
   */
  const requestKey = `${fromDay}#${reloadKey}#${retry}`;
  useEffect(() => {
    let live = true;
    loadRef.current(fromDay).then(
      (res) => {
        if (!live) return;
        setLoaded({ key: requestKey, page: res });
        if (res.ok) {
          const first = res.slots[0]?.dayKey ?? null;
          setDay((d) => (d && res.slots.some((s) => s.dayKey === d) ? d : first));
        }
      },
      (e: unknown) => {
        // A dropped connection is said in words, with a Retry beside it.
        console.error("[slot-picker] could not load times", e);
        if (live) setLoaded({ key: requestKey, page: { ok: false, error: t("pastoral.public.loadFailed") } });
      },
    );
    return () => {
      live = false;
    };
  }, [requestKey, fromDay, t]);

  const loading = loaded?.key !== requestKey;
  const page = loaded?.page ?? null;

  const days = useMemo(() => {
    if (!page?.ok) return [];
    return [...new Set(page.slots.map((s) => s.dayKey))];
  }, [page]);

  const dayLabel = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Intl.DateTimeFormat(t.intl, {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  };
  const timeLabel = (iso: string, zone: string) =>
    new Intl.DateTimeFormat(t.intl, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

  const later = () => {
    if (!page?.ok) return;
    setHistory((h) => [...h, fromDay]);
    setFromDay(page.nextFromDay);
    onChange(null);
  };
  const earlier = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory(history.slice(0, -1));
    setFromDay(prev);
    onChange(null);
  };

  return (
    <div className="space-y-3">
      {page?.ok && (
        <p className="text-muted-foreground text-xs">{t("pastoral.public.timesIn", { zone: page.zone })}</p>
      )}

      {loading && (
        <p className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
          <Loader2 className="size-4 animate-spin" /> {t("common.loading")}
        </p>
      )}

      {!loading && page && !page.ok && (
        <div role="alert" className="border-destructive/30 bg-destructive/5 space-y-2 rounded-xl border px-4 py-3">
          <p className="text-sm">{page.error}</p>
          <Button size="sm" variant="outline" onClick={() => setRetry((n) => n + 1)}>
            <RefreshCw className="size-3.5" /> {t("common.tryAgain")}
          </Button>
        </div>
      )}

      {!loading && page?.ok && page.slots.length === 0 && (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-6 text-center text-sm">
          {emptyText}
        </p>
      )}

      {!loading && page?.ok && page.slots.length > 0 && (
        <>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {days.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setDay(k)}
                className={cn(
                  "min-h-11 shrink-0 rounded-xl border px-3 py-2 text-sm font-semibold whitespace-nowrap transition",
                  day === k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {dayLabel(k)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {page.slots
              .filter((s) => s.dayKey === day)
              .map((s) => (
                <button
                  key={s.startsAt}
                  type="button"
                  onClick={() => onChange(s.startsAt)}
                  aria-pressed={value === s.startsAt}
                  className={cn(
                    "min-h-11 rounded-xl border px-2 py-2 text-sm font-semibold tabular-nums transition",
                    value === s.startsAt ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {timeLabel(s.startsAt, page.zone)}
                </button>
              ))}
          </div>
        </>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11"
          disabled={loading || history.length === 0}
          onClick={earlier}
        >
          <ChevronLeft className="size-4" /> {t("pastoral.slots.earlier")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11"
          disabled={loading || !page?.ok}
          onClick={later}
        >
          {t("pastoral.slots.later")} <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
