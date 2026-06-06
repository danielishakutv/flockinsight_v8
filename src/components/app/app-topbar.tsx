import { Wordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { UserMenu } from "@/components/app/user-menu";

export function AppTopbar({
  userName,
  userEmail,
  isSuperAdmin = false,
}: {
  userName: string;
  userEmail: string;
  isSuperAdmin?: boolean;
}) {
  return (
    <header className="bg-background/80 sticky top-0 z-30 flex h-16 items-center justify-between border-b px-4 backdrop-blur lg:hidden">
      <Wordmark logoClassName="size-8" className="text-lg" />
      <div className="flex items-center gap-1">
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
