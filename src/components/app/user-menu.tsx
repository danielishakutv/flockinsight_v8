"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import Link from "next/link";
import {
  Bell,
  Check,
  Church,
  Laptop,
  LogOut,
  Moon,
  Settings,
  Shield,
  Sun,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { signOut } from "@/lib/auth-client";
import { chooseChurch } from "@/app/select-church/actions";
import { useT } from "@/components/i18n-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** How many churches fit in the menu before it becomes a page of its own. */
const INLINE_CHURCH_LIMIT = 6;

export function UserMenu({
  name,
  email,
  image,
  className,
  isSuperAdmin = false,
  churches = [],
  activeChurchId = null,
}: {
  name: string;
  email: string;
  /** Their own photo, set on /profile. Initials until there is one. */
  image?: string | null;
  className?: string;
  isSuperAdmin?: boolean;
  /**
   * Every church this person is staff in. One or none means no switcher —
   * showing a list of one is noise in a menu that is already busy.
   */
  churches?: { id: string; name: string }[];
  activeChurchId?: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const { setTheme } = useTheme();
  const [switching, startSwitch] = useTransition();

  function switchTo(id: string) {
    if (id === activeChurchId) return;
    startSwitch(async () => {
      const res = await chooseChurch(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      /*
       * Home, not wherever they were. Half the app is addressed by a record id
       * that belongs to the church they just left — a member page, a service, a
       * meeting — and staying put would mean a not-found or, worse, a page that
       * looks right with somebody else's numbers on it.
       */
      router.push("/dashboard");
      router.refresh();
    });
  }

  async function handleSignOut() {
    await signOut();
    toast.success(t("nav.signedOut"));
    router.push("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`flex items-center gap-3 rounded-xl p-1.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-ring focus-visible:ring-2 ${className ?? ""}`}
      >
        <Avatar className="size-9">
          {image && <AvatarImage src={image} alt="" />}
          <AvatarFallback className="bg-primary/15 text-primary font-bold">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 max-sm:hidden">
          <p className="truncate text-sm font-semibold leading-tight">{name}</p>
          <p className="text-muted-foreground truncate text-xs">{email}</p>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate">{name}</span>
          <span className="text-muted-foreground truncate text-xs font-normal">
            {email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* First, and above the church's own settings: this one belongs to
            the person, and for a member with a staff login it is the only
            settings page they can open at all. */}
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserRound />
            {t("nav.yourProfile")}
          </Link>
        </DropdownMenuItem>
        {/*
          Notifications and Settings live here rather than above the avatar in
          the sidebar. Both are about the person and the account rather than
          about running the church, and two permanent rows in a menu of
          twenty-seven modules is two rows the menu could have spent on the
          work. The sidebar's `accountMenu` flag in `lib/nav.ts` is the other
          half of this; the phone's menu sheet still lists them inline, where
          there is no avatar menu to put them behind.
        */}
        <DropdownMenuItem asChild>
          <Link href="/notifications">
            <Bell />
            {t("nav.notifications")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings />
            {t("nav.settings")}
          </Link>
        </DropdownMenuItem>
        {isSuperAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/superadmin">
              <Shield />
              {t("nav.platformAdmin")}
            </Link>
          </DropdownMenuItem>
        )}
        {churches.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              {t("nav.yourChurches")}
            </DropdownMenuLabel>
            {churches.slice(0, INLINE_CHURCH_LIMIT).map((c) => (
              <DropdownMenuItem
                key={c.id}
                disabled={switching}
                onClick={() => switchTo(c.id)}
              >
                {c.id === activeChurchId ? <Check /> : <Church />}
                <span className="truncate">{c.name}</span>
              </DropdownMenuItem>
            ))}
            {churches.length > INLINE_CHURCH_LIMIT && (
              <DropdownMenuItem asChild>
                <Link href="/select-church">
                  <Church />
                  {t("nav.chooseChurch")}
                </Link>
              </DropdownMenuItem>
            )}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          {t("nav.theme")}
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun /> {t("nav.themeLight")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon /> {t("nav.themeDark")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Laptop /> {t("nav.themeSystem")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
          <LogOut /> {t("nav.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
