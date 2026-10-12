"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Bell, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { markAllNotificationsRead } from "@/app/(app)/notifications/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

type Item = {
  id: string;
  title: string;
  body: string;
  category: "system" | "general";
  linkUrl: string | null;
  createdAt: string;
  read: boolean;
};

/**
 * Bell with a live unread badge AND a dropdown of recent notifications, so a
 * click shows a quick preview (+ "View all") instead of jumping to the page.
 */
export function LiveNotificationBell({
  initial = 0,
  className,
}: {
  initial?: number;
  className?: string;
}) {
  const t = useT();
  const [count, setCount] = useState(initial);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  /*
   * Its own state, not an empty list. "Couldn't load" and "nothing to read"
   * used to render the same "You're all caught up" — under a badge that said
   * 5 unread — so a failed fetch or an expired session looked like good news.
   */
  const [loadError, setLoadError] = useState(false);
  const [marking, setMarking] = useState(false);
  // Last poll outcome, so a dropped connection is logged once rather than
  // every 20 seconds while it lasts.
  const pollFailing = useRef(false);

  // Keep the unread badge live by polling.
  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const r = await fetch("/api/notifications/unread", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (active && typeof d.count === "number") setCount(d.count);
        pollFailing.current = false;
      } catch (err) {
        // The badge keeps its last known count and the next poll (or focus)
        // repairs it; recorded on the first failure of a run so it is not
        // invisible.
        if (!pollFailing.current) {
          console.warn("[notifications] unread poll failed", err);
          pollFailing.current = true;
        }
      }
    }
    const id = setInterval(poll, 20_000);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    void poll();
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const r = await fetch("/api/notifications/recent", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (!Array.isArray(d?.items)) throw new Error("no items in response");
      setItems(d.items);
    } catch (err) {
      // Keep whatever was shown before; say it could not be refreshed.
      console.warn("[notifications] could not load recent", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  async function markAll() {
    if (marking) return;
    setMarking(true);
    try {
      const res = await markAllNotificationsRead();
      if (!res.ok) throw new Error(res.error);
      setCount(0);
      setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    } catch (err) {
      // The badge is left as it was: clearing it here would claim the server
      // marked them read when it did not.
      console.warn("[notifications] mark all read failed", err);
      toast.error("Couldn't mark notifications as read. Try again.");
    } finally {
      setMarking(false);
    }
  }

  return (
    <DropdownMenu
      onOpenChange={(o) => {
        // `void`: load() handles its own failure (an error row with Retry,
        // loading cleared in `finally`), so there is nothing here to wait for.
        if (o) void load();
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={count > 0 ? `Notifications (${count} unread)` : "Notifications"}
          className={cn(
            "text-muted-foreground hover:text-foreground hover:bg-accent relative grid size-9 place-items-center rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary",
            className,
          )}
        >
          <Bell className="size-5" />
          {count > 0 && (
            <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold tabular-nums">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[22rem] max-w-[calc(100vw-1rem)] p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
          <p className="text-sm font-bold">{t("notifications.notifications")}</p>
          {/*
           * Every control in here is a menu item, not a bare <button>: a
           * Radix menu takes Tab and the arrow keys for itself, so a plain
           * button inside it cannot be reached from a keyboard at all — and
           * the Retry rows would be a dead end for exactly the person who
           * needs them. preventDefault keeps the menu open while it works.
           */}
          {count > 0 && (
            <DropdownMenuItem
              disabled={marking}
              onSelect={(e) => {
                e.preventDefault();
                void markAll();
              }}
              className="text-primary px-2 py-1 text-xs font-semibold hover:underline"
            >
              Mark all read
            </DropdownMenuItem>
          )}
        </div>

        <div className="max-h-[22rem] overflow-y-auto py-1">
          {loading ? (
            <div className="grid place-items-center py-10">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : loadError && items.length === 0 ? (
            <div className="text-muted-foreground px-3 py-8 text-center text-sm">
              <p>Couldn&apos;t load notifications.</p>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  void load();
                }}
                className="text-primary mx-auto mt-1 min-h-11 w-fit justify-center px-3 font-semibold hover:underline"
              >
                Retry
              </DropdownMenuItem>
            </div>
          ) : items.length === 0 ? (
            // Only after a load that succeeded and came back empty.
            <p className="text-muted-foreground px-3 py-10 text-center text-sm">
              You&apos;re all caught up. 🎉
            </p>
          ) : (
            <>
              {loadError && (
                <div className="text-muted-foreground flex items-center justify-between gap-2 border-b px-3 py-1 text-xs">
                  <span>Couldn&apos;t refresh. Showing earlier ones.</span>
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      void load();
                    }}
                    className="text-primary min-h-11 shrink-0 justify-center px-2 text-xs font-semibold hover:underline"
                  >
                    Retry
                  </DropdownMenuItem>
                </div>
              )}
              {items.map((n) => (
                <DropdownMenuItem key={n.id} asChild className="cursor-pointer">
                  <Link
                    href={n.linkUrl || "/notifications"}
                    className="flex items-start gap-2.5 px-3 py-2.5"
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        n.read ? "bg-transparent" : "bg-primary",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {n.title}
                      </span>
                      <span className="text-muted-foreground line-clamp-2 block text-xs">
                        {n.body}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-[11px]">
                        {formatDistanceToNow(parseISO(n.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </span>
                  </Link>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </div>

        <div className="border-t p-1">
          <DropdownMenuItem asChild className="cursor-pointer">
            <Link
              href="/notifications"
              className="text-primary justify-center py-2 text-sm font-semibold"
            >
              View all notifications
            </Link>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
