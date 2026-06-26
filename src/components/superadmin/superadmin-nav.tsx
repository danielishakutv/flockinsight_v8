"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Overview", href: "/superadmin" },
  { label: "Churches", href: "/superadmin/churches" },
  { label: "Notifications", href: "/superadmin/notifications" },
  { label: "SMS", href: "/superadmin/sms" },
  { label: "Pricing", href: "/superadmin/pricing" },
  { label: "Support", href: "/superadmin/support" },
  { label: "Backups", href: "/superadmin/backups" },
];

export function SuperadminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto">
      {tabs.map((t) => {
        const active =
          t.href === "/superadmin"
            ? pathname === "/superadmin"
            : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "relative whitespace-nowrap px-4 py-2.5 text-sm font-semibold transition-colors",
              active
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {active && (
              <span className="bg-primary absolute inset-x-3 -bottom-px h-0.5 rounded-full" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
