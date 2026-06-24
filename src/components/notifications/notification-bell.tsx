import Link from "next/link";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

export function NotificationBell({
  unread,
  className,
}: {
  unread: number;
  className?: string;
}) {
  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
      className={cn(
        "text-muted-foreground hover:text-foreground hover:bg-accent relative grid size-9 place-items-center rounded-lg transition-colors",
        className,
      )}
    >
      <Bell className="size-5" />
      {unread > 0 && (
        <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold tabular-nums">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
