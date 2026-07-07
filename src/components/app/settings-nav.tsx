"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  Globe,
  ListChecks,
  HandCoins,
  BellRing,
  PartyPopper,
  HeartHandshake,
  MessageSquare,
  Wallet,
  HardDrive,
  CreditCard,
  Users,
  ShieldCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Need = "settings" | "team";
type Item = { label: string; href: string; need: Need; icon: LucideIcon };
type Group = { title: string; items: Item[] };

const GROUPS: Group[] = [
  {
    title: "Church",
    items: [
      { label: "General", href: "/settings", need: "settings", icon: Building2 },
      { label: "Public page", href: "/settings/public", need: "settings", icon: Globe },
      { label: "Services", href: "/settings/services", need: "settings", icon: ListChecks },
      { label: "Giving", href: "/settings/giving", need: "settings", icon: HandCoins },
    ],
  },
  {
    title: "Engagement",
    items: [
      { label: "Reminders", href: "/settings/reminders", need: "settings", icon: BellRing },
      { label: "First-timers", href: "/settings/first-timers", need: "settings", icon: HeartHandshake },
      { label: "Celebrations", href: "/settings/celebrations", need: "settings", icon: PartyPopper },
      { label: "SMS", href: "/settings/sms", need: "settings", icon: MessageSquare },
    ],
  },
  {
    title: "Billing",
    items: [
      { label: "Wallet", href: "/settings/wallet", need: "settings", icon: Wallet },
      { label: "Storage", href: "/settings/storage", need: "settings", icon: HardDrive },
      { label: "Plan & billing", href: "/settings/billing", need: "settings", icon: CreditCard },
    ],
  },
  {
    title: "People",
    items: [
      { label: "Sign-up link", href: "/settings/signup", need: "settings", icon: UserPlus },
      { label: "Team", href: "/settings/team", need: "team", icon: Users },
      { label: "Roles", href: "/settings/roles", need: "team", icon: ShieldCheck },
    ],
  },
];

export function SettingsNav({
  canSettings,
  canTeam,
}: {
  canSettings: boolean;
  canTeam: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const allow = (need: Need) => (need === "settings" ? canSettings : canTeam);
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => allow(i.need)),
  })).filter((g) => g.items.length > 0);

  const flat = groups.flatMap((g) => g.items);
  const active = flat.find((i) => i.href === pathname)?.href ?? flat[0]?.href;

  return (
    <>
      {/* Mobile: a dropdown (no horizontal scrolling) */}
      <div className="lg:hidden">
        <label className="text-muted-foreground mb-1.5 block text-xs font-semibold uppercase">
          Settings
        </label>
        <select
          value={active}
          onChange={(e) => router.push(e.target.value)}
          className="border-input bg-background h-11 w-full rounded-xl border px-3 text-sm font-medium shadow-sm focus:outline-none"
        >
          {groups.map((g) => (
            <optgroup key={g.title} label={g.title}>
              {g.items.map((i) => (
                <option key={i.href} value={i.href}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Desktop: grouped vertical nav */}
      <nav className="hidden lg:block">
        <div className="sticky top-6 space-y-5">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="text-muted-foreground mb-1.5 px-3 text-xs font-bold uppercase tracking-wide">
                {g.title}
              </p>
              <div className="space-y-0.5">
                {g.items.map((i) => {
                  const isActive = pathname === i.href;
                  return (
                    <Link
                      key={i.href}
                      href={i.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <i.icon className="size-4 shrink-0" />
                      {i.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}
