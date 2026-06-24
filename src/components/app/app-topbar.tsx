import { Wordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { UserMenu } from "@/components/app/user-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";

export function AppTopbar({
  userName,
  userEmail,
  isSuperAdmin = false,
  unread = 0,
}: {
  userName: string;
  userEmail: string;
  isSuperAdmin?: boolean;
  unread?: number;
}) {
  return (
    <header className="bg-background/80 sticky top-0 z-30 flex h-16 items-center justify-between border-b px-4 backdrop-blur lg:hidden">
      <Wordmark logoClassName="size-8" className="text-lg" />
      <div className="flex items-center gap-1">
        <NotificationBell unread={unread} />
        <ThemeToggle />
        <UserMenu
          name={userName}
          email={userEmail}
          isSuperAdmin={isSuperAdmin}
        />
      </div>
    </header>
  );
}
