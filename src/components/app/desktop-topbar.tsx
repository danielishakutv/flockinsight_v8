import Link from "next/link";
import { Plus } from "lucide-react";
import { DateTime } from "@/components/app/date-time";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";

/** Desktop-only top bar: live date/time on the left, bell + theme + the
 *  primary "Record attendance" action on the right. */
export function DesktopTopbar({
  unread = 0,
  canRecord = false,
}: {
  unread?: number;
  canRecord?: boolean;
}) {
  return (
    <header className="bg-background/80 sticky top-0 z-30 hidden h-16 items-center justify-between gap-4 border-b px-6 backdrop-blur lg:flex">
      <DateTime />
      <div className="flex items-center gap-1.5">
        <NotificationBell unread={unread} />
        <ThemeToggle />
        {canRecord && (
          <Button asChild className="ml-1">
            <Link href="/attendance/record">
              <Plus className="size-4" />
              Record attendance
            </Link>
          </Button>
        )}
      </div>
    </header>
  );
}
