"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Church } from "lucide-react";
import { cn } from "@/lib/utils";
import { mainNav, navAllowed, recordAction } from "@/lib/nav";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/app/user-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({
  churchName,
  userName,
  userEmail,
  isSuperAdmin = false,
  perms = [],
  isOwner = false,
  unread = 0,
}: {
  churchName: string;
  userName: string;
  userEmail: string;
  isSuperAdmin?: boolean;
  perms?: string[];
  isOwner?: boolean;
  unread?: number;
}) {
  const pathname = usePathname();
  const items = mainNav.filter((i) => navAllowed(i.perm, perms, isOwner));
  const canRecord = navAllowed(recordAction.perm, perms, isOwner);

  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden w-72 shrink-0 self-start border-r lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Wordmark />
        <NotificationBell unread={unread} className="-mr-1.5" />
      </div>

      {/* church badge */}
      <div className="px-3">
        <div className="bg-sidebar-accent/60 flex items-center gap-2.5 rounded-xl px-3 py-2.5">
          <Church className="text-primary size-4 shrink-0" />
          <span className="truncate text-sm font-semibold">{churchName}</span>
        </div>
      </div>

      {canRecord && (
        <div className="px-3 pt-4">
          <Button asChild size="lg" className="w-full justify-start gap-3">
            <Link href={recordAction.href}>
              <recordAction.icon className="size-5" />
              Record Attendance
            </Link>
          </Button>
        </div>
      )}

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <item.icon className="size-5 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <UserMenu
          name={userName}
          email={userEmail}
          isSuperAdmin={isSuperAdmin}
          className="w-full"
        />
      </div>
    </aside>
  );
}
