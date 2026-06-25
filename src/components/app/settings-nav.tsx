"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type Tab = { label: string; href: string; need: "settings" | "team" };

const allTabs: Tab[] = [
  { label: "General", href: "/settings", need: "settings" },
  { label: "Services", href: "/settings/services", need: "settings" },
  { label: "Giving", href: "/settings/giving", need: "settings" },
  { label: "SMS", href: "/settings/sms", need: "settings" },
  { label: "Billing", href: "/settings/billing", need: "settings" },
  { label: "Team", href: "/settings/team", need: "team" },
  { label: "Roles", href: "/settings/roles", need: "team" },
];

export function SettingsNav({
  canSettings,
  canTeam,
}: {
  canSettings: boolean;
  canTeam: boolean;
}) {
  const pathname = usePathname();
  const tabs = allTabs.filter((t) =>
    t.need === "settings" ? canSettings : canTeam,
  );
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => {
        const active = pathname === t.href;
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
    </div>
  );
}
