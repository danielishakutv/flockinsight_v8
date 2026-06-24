"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, LayoutGrid, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  mobileMenuSections,
  mobileNavLeft,
  mobileNavRight,
  navAllowed,
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

export function MobileNav({
  perms = [],
  isOwner = false,
}: {
  perms?: string[];
  isOwner?: boolean;
}) {
  const pathname = usePathname();
  const recordActive = isActive(pathname, recordAction.href);
  const [moreOpen, setMoreOpen] = useState(false);

  const leftItems = mobileNavLeft.filter((i) =>
    navAllowed(i.perm, perms, isOwner),
  );
  const rightItems = mobileNavRight.filter((i) =>
    navAllowed(i.perm, perms, isOwner),
  );
  const canRecord = navAllowed(recordAction.perm, perms, isOwner);
  const sections = mobileMenuSections
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => navAllowed(i.perm, perms, isOwner)),
    }))
    .filter((s) => s.items.length > 0);

  // The "More" tab is active when on a route that isn't one of the quick tabs.
  const quickHrefs = [...leftItems, ...rightItems, recordAction].map(
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
          {leftItems.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </div>

        {/* Center Record button */}
        {canRecord && (
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
        )}

        <div className="flex flex-1 items-stretch">
          {rightItems.map((item) => (
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
            className="bg-background animate-in slide-in-from-bottom-6 fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-3xl border-t shadow-2xl duration-200"
          >
            <div className="bg-muted mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full" />
            <div className="flex shrink-0 items-center justify-between px-5 pt-3 pb-2">
              <div>
                <p className="text-xl font-extrabold tracking-tight">Menu</p>
                <p className="text-muted-foreground text-xs">
                  Jump to any part of FlockInsight
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="bg-muted/60 text-muted-foreground hover:text-foreground grid size-9 place-items-center rounded-full"
              >
                <X className="size-5" />
              </button>
            </div>

            <div
              className="space-y-5 overflow-y-auto px-4 pt-2"
              style={{
                paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)",
              }}
            >
              {sections.map((section) => (
                <div key={section.title}>
                  <p className="text-muted-foreground mb-1.5 px-2 text-[11px] font-bold tracking-wider uppercase">
                    {section.title}
                  </p>
                  <div className="bg-card overflow-hidden rounded-2xl border">
                    {section.items.map((item, i) => {
                      const active = isActive(pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setMoreOpen(false)}
                          className={cn(
                            "flex items-center gap-3 p-2.5 transition-colors active:bg-accent",
                            i > 0 && "border-t",
                            active && "bg-primary/5",
                          )}
                        >
                          <span
                            className={cn(
                              "grid size-11 shrink-0 place-items-center rounded-xl",
                              item.tile,
                            )}
                          >
                            <item.icon className="size-5" strokeWidth={2.2} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p
                              className={cn(
                                "leading-tight font-semibold",
                                active && "text-primary",
                              )}
                            >
                              {item.label}
                            </p>
                            <p className="text-muted-foreground truncate text-xs">
                              {item.description}
                            </p>
                          </div>
                          <ChevronRight className="text-muted-foreground/60 size-4 shrink-0" />
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
