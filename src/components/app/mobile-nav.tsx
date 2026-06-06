"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { mobileNavLeft, mobileNavRight, recordAction, type NavItem } from "@/lib/nav";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-semibold transition-colors",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <item.icon className={cn("size-6", active && "fill-primary/10")} />
      {item.label}
    </Link>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const recordActive = isActive(pathname, recordAction.href);

  return (
    <nav
      className="bg-background/90 fixed inset-x-0 bottom-0 z-30 flex items-end border-t backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex flex-1 items-stretch">
        {mobileNavLeft.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </div>

      {/* Center Record button */}
      <div className="flex w-20 shrink-0 justify-center">
        <Link
          href={recordAction.href}
          aria-label="Record attendance"
          className={cn(
            "-mt-6 grid size-16 place-items-center rounded-full border-4 border-background shadow-lg transition-transform active:scale-95",
            recordActive
              ? "bg-primary text-primary-foreground"
              : "bg-primary text-primary-foreground",
          )}
        >
          <recordAction.icon className="size-7" strokeWidth={2.5} />
        </Link>
      </div>

      <div className="flex flex-1 items-stretch">
        {mobileNavRight.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </div>
    </nav>
  );
}
