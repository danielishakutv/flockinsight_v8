"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Church } from "lucide-react";
import { cn } from "@/lib/utils";
import { mobileMenuSections, navAllowed } from "@/lib/nav";
import { Wordmark } from "@/components/brand";
import { UserMenu } from "@/components/app/user-menu";

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
}: {
  churchName: string;
  userName: string;
  userEmail: string;
  isSuperAdmin?: boolean;
  perms?: string[];
  isOwner?: boolean;
}) {
  const pathname = usePathname();
  const sections = mobileMenuSections
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => navAllowed(i.perm, perms, isOwner)),
    }))
    .filter((s) => s.items.length > 0);

  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden w-72 shrink-0 self-start border-r lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
      <div className="flex h-16 items-center px-5">
        <Wordmark />
      </div>

      {/* church badge */}
      <div className="px-3">
        <div className="bg-sidebar-accent/60 flex items-center gap-2.5 rounded-xl px-3 py-2.5">
          <Church className="text-primary size-4 shrink-0" />
          <span className="truncate text-sm font-semibold">{churchName}</span>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto p-3 pt-4">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="text-sidebar-foreground/45 mb-1.5 px-2.5 text-[10px] font-bold tracking-wider uppercase">
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors",
                      active
                        ? "bg-primary/10"
                        : "hover:bg-sidebar-accent",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-lg",
                        active ? "bg-primary text-primary-foreground" : item.tile,
                      )}
                    >
                      <item.icon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-sm leading-tight font-semibold",
                          active
                            ? "text-primary"
                            : "text-sidebar-foreground/90",
                        )}
                      >
                        {item.label}
                      </p>
                      <p className="text-sidebar-foreground/50 truncate text-[11px] leading-tight">
                        {item.description}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
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
