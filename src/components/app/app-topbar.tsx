import { Wordmark } from "@/components/brand";
import { LanguageMenu } from "@/components/app/language-menu";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { UserMenu } from "@/components/app/user-menu";
import { LiveNotificationBell } from "@/components/notifications/live-notification-bell";

export function AppTopbar({
  userName,
  userEmail,
  userImage,
  isSuperAdmin = false,
  unread = 0,
  churches = [],
  activeChurchId = null,
}: {
  userName: string;
  userEmail: string;
  userImage?: string | null;
  isSuperAdmin?: boolean;
  unread?: number;
  churches?: { id: string; name: string }[];
  activeChurchId?: string | null;
}) {
  return (
    <header className="bg-background/80 sticky top-[env(safe-area-inset-top)] z-30 flex h-16 items-center justify-between border-b px-4 backdrop-blur lg:hidden">
      <Wordmark logoClassName="size-8" className="text-lg" />
      <div className="flex items-center gap-1">
        <LiveNotificationBell initial={unread} />
        <LanguageMenu />
        <ThemeToggle />
        <UserMenu
          name={userName}
          email={userEmail}
          image={userImage}
          isSuperAdmin={isSuperAdmin}
          churches={churches}
          activeChurchId={activeChurchId}
        />
      </div>
    </header>
  );
}
