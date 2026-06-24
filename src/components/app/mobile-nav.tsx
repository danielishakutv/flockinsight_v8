"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  mainNav,
  mobileNavLeft,
  mobileNavRight,
  recordAction,
  type NavItem,
} from "@/lib/nav";

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
  const [moreOpen, setMoreOpen] = useState(false);

  // The "More" tab is active when on a route that isn't one of the quick tabs.
  const quickHrefs = [...mobileNavLeft, ...mobileNavRight, recordAction].map(
    (i) => i.href,
  );
  const moreActive = !quickHrefs.some((href) => isActive(pathname, href));

  return (
    <>
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
              "border-background -mt-6 grid size-16 place-items-center rounded-full border-4 shadow-lg transition-transform active:scale-95",
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
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="More menu"
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-semibold transition-colors",
              moreActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <LayoutGrid
              className={cn("size-6", moreActive && "fill-primary/10")}
            />
            More
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="lg:hidden">
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="animate-in fade-in fixed inset-0 z-40 bg-black/50 backdrop-blur-sm duration-200"
          />
          {/* Sheet */}
          <div
            className="bg-background animate-in slide-in-from-bottom-6 fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t shadow-2xl duration-200"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
          >
            <div className="bg-muted mx-auto mt-3 h-1.5 w-12 rounded-full" />
            <div className="flex items-center justify-between px-5 pt-3 pb-1">
              <p className="text-lg font-extrabold tracking-tight">Menu</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground -mr-1 p-1"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2 p-4 pt-2">
              {mainNav.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center transition-colors",
                      active
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "bg-card text-foreground hover:bg-accent",
                    )}
                  >
                    <item.icon className="size-6 shrink-0" />
                    <span className="text-[11px] leading-tight font-semibold">
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
