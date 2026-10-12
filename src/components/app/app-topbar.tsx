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
  isPartner = false,
  unread = 0,
  churches = [],
  activeChurchId = null,
}: {
  userName: string;
  userEmail: string;
  userImage?: string | null;
  isSuperAdmin?: boolean;
  isPartner?: boolean;
  unread?: number;
  churches?: { id: string; name: string }[];
  activeChurchId?: string | null;
}) {
  return (
    <header className="bg-background/80 sticky top-[env(safe-area-inset-top)] z-30 flex h-16 items-center justify-between border-b px-4 backdrop-blur lg:hidden">
      {/*
        The name goes below 380px and the mark stays. Four 44px controls and
        the full wordmark need ~362px, so on a 320px or 360px phone the whole
        app scrolled sideways on every page — measured, not guessed
        (scripts/measure-pages.mjs).
      */}
      <Wordmark
        logoClassName="size-8"
        className="min-w-0 text-lg"
        textClassName="max-[379px]:hidden"
      />
      <div className="flex shrink-0 items-center gap-1">
        <LiveNotificationBell initial={unread} />
        <LanguageMenu />
        <ThemeToggle />
        <UserMenu
          name={userName}
          email={userEmail}
          image={userImage}
          isSuperAdmin={isSuperAdmin}
          isPartner={isPartner}
          churches={churches}
          activeChurchId={activeChurchId}
        />
      </div>
    </header>
  );
}
