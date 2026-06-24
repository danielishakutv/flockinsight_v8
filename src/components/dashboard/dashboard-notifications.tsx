import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Bell, ChevronRight, Cog, Megaphone } from "lucide-react";
import { listNotifications, type NotificationCtx } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export async function DashboardNotifications({ ctx }: { ctx: NotificationCtx }) {
  const items = await listNotifications(ctx, { limit: 4 });
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bell className="text-primary size-5" /> Notifications
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href="/notifications">
            View all <ChevronRight className="size-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((n) => {
          const Icon = n.category === "system" ? Cog : Megaphone;
          return (
            <Link
              key={n.id}
              href="/notifications"
              className="hover:bg-accent flex items-start gap-3 rounded-xl px-2 py-2"
            >
              <div
                className={
                  "grid size-8 shrink-0 place-items-center rounded-lg " +
                  (n.category === "system"
                    ? "bg-sky-500/15 text-sky-600 dark:text-sky-400"
                    : "bg-primary/15 text-primary")
                }
              >
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold">{n.title}</p>
                  {!n.read && (
                    <span className="bg-primary size-2 shrink-0 rounded-full" />
                  )}
                </div>
                <p className="text-muted-foreground truncate text-xs">
                  {n.body}
                </p>
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  {formatDistanceToNow(n.createdAt, { addSuffix: true })}
                </p>
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
