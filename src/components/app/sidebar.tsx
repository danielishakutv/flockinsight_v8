"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Church } from "lucide-react";
import { cn } from "@/lib/utils";
import { mobileMenuSections, navVisible } from "@/lib/nav";
import { Wordmark } from "@/components/brand";
import { UserMenu } from "@/components/app/user-menu";
import { useT } from "@/components/i18n-provider";
import { BetaBadge } from "@/components/beta-badge";
import { PlanChip } from "@/components/app/plan-chip";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({
  churchName,
  userName,
  userEmail,
  userImage,
  isSuperAdmin = false,
  perms = [],
  churchSlug = null,
  isOwner = false,
  plan = "starter",
  churches = [],
  activeChurchId = null,
}: {
  churchName: string;
  userName: string;
  userEmail: string;
  userImage?: string | null;
  isSuperAdmin?: boolean;
  perms?: string[];
  /** For hiding a module that is only being piloted elsewhere. */
  churchSlug?: string | null;
  isOwner?: boolean;
  /**
   * The church's plan, so the menu can say which tier a module needs. Defaults
   * to the smallest, like every other allowance in the app.
   */
  plan?: string;
  /** For the switcher in the account menu. Empty or one = no switcher. */
  churches?: { id: string; name: string }[];
  activeChurchId?: string | null;
}) {
  const t = useT();
  const pathname = usePathname();
  const sections = mobileMenuSections
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => navVisible(i, perms, isOwner, churchSlug)),
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
          <div key={section.titleKey}>
            <p className="text-sidebar-foreground/45 mb-1.5 px-2.5 text-[10px] font-bold tracking-wider uppercase">
              {t(section.titleKey)}
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
                          "flex items-center gap-1.5 truncate text-sm leading-tight font-semibold",
                          active
                            ? "text-primary"
                            : "text-sidebar-foreground/90",
                        )}
                      >
                        <span className="truncate">{t(item.labelKey)}</span>
                        {item.beta && <BetaBadge />}
                        {item.feature && <PlanChip feature={item.feature} plan={plan} />}
                      </p>
                      <p className="text-sidebar-foreground/50 truncate text-[11px] leading-tight">
                        {t(item.descriptionKey)}
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
          image={userImage}
          isSuperAdmin={isSuperAdmin}
          churches={churches}
          activeChurchId={activeChurchId}
          className="w-full"
        />
      </div>
    </aside>
  );
}
