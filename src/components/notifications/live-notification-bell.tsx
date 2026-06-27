"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Bell, Loader2 } from "lucide-react";
import { markAllNotificationsRead } from "@/app/(app)/notifications/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

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
  const [count, setCount] = useState(initial);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);

  // Keep the unread badge live by polling.
  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const r = await fetch("/api/notifications/unread", { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (active && typeof d.count === "number") setCount(d.count);
      } catch {
        /* ignore transient errors */
      }
    }
    const id = setInterval(poll, 20_000);
    const onFocus = () => poll();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    poll();
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/notifications/recent", { cache: "no-store" });
      const d = await r.json();
      setItems(Array.isArray(d.items) ? d.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function markAll() {
    if (marking) return;
    setMarking(true);
    try {
      await markAllNotificationsRead();
      setCount(0);
      setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    } catch {
      /* ignore */
    } finally {
      setMarking(false);
    }
  }

  return (
    <DropdownMenu
      onOpenChange={(o) => {
        if (o) load();
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
          <p className="text-sm font-bold">Notifications</p>
          {count > 0 && (
            <button
              type="button"
              onClick={markAll}
              disabled={marking}
              className="text-primary text-xs font-semibold hover:underline disabled:opacity-50"
            >
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[22rem] overflow-y-auto py-1">
          {loading ? (
            <div className="grid place-items-center py-10">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground px-3 py-10 text-center text-sm">
              You&apos;re all caught up. 🎉
            </p>
          ) : (
            items.map((n) => (
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
            ))
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
