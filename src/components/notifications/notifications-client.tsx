"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Bell, CheckCheck, Cog, ExternalLink, Megaphone } from "lucide-react";
import { toast } from "sonner";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/app/(app)/notifications/actions";
import { PushToggle } from "@/components/notifications/push-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type NotificationView = {
  id: string;
  title: string;
  body: string;
  category: "system" | "general";
  linkUrl: string | null;
  createdAt: string; // ISO
  read: boolean;
};

type Tab = "all" | "general" | "system";

export function NotificationsClient({
  items,
}: {
  items: NotificationView[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("all");
  const [pending, startTransition] = useTransition();

  const unread = items.filter((i) => !i.read).length;
  const filtered = useMemo(
    () => (tab === "all" ? items : items.filter((i) => i.category === tab)),
    [items, tab],
  );

  function open(item: NotificationView) {
    if (!item.read) {
      startTransition(async () => {
        await markNotificationRead(item.id);
        router.refresh();
      });
    }
    if (item.linkUrl) {
      if (/^https?:\/\//.test(item.linkUrl)) window.open(item.linkUrl, "_blank");
      else router.push(item.linkUrl);
    }
  }

  function markAll() {
    startTransition(async () => {
      await markAllNotificationsRead();
      toast.success("All caught up");
      router.refresh();
    });
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "general", label: "General" },
    { id: "system", label: "System" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <PushToggle />
          {unread > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={markAll}
              disabled={pending}
            >
              <CheckCheck className="size-4" />
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="bg-primary/10 text-primary grid size-14 place-items-center rounded-2xl">
              <Bell className="size-7" />
            </div>
            <p className="text-muted-foreground">
              No notifications yet. Updates from the FlockInsight team will show
              here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((n) => {
            const Icon = n.category === "system" ? Cog : Megaphone;
            return (
              <button
                key={n.id}
                onClick={() => open(n)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-2xl border p-3 text-left shadow-sm transition-colors sm:p-4",
                  n.read
                    ? "bg-card hover:bg-accent"
                    : "border-primary/30 bg-primary/5 hover:bg-primary/10",
                )}
              >
                <div
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-xl",
                    n.category === "system"
                      ? "bg-sky-500/15 text-sky-600 dark:text-sky-400"
                      : "bg-primary/15 text-primary",
                  )}
                >
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold">{n.title}</p>
                    {!n.read && (
                      <span className="bg-primary size-2 shrink-0 rounded-full" />
                    )}
                    <Badge variant="outline" className="ml-auto shrink-0 capitalize">
                      {n.category}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm whitespace-pre-line">
                    {n.body}
                  </p>
                  <p
                    className="text-muted-foreground mt-2 inline-flex items-center gap-1 text-xs"
                    suppressHydrationWarning
                  >
                    {formatDistanceToNow(parseISO(n.createdAt), {
                      addSuffix: true,
                    })}
                    {n.linkUrl && (
                      <>
                        {" · "}
                        <ExternalLink className="size-3" /> Open
                      </>
                    )}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
