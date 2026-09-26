"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Gift,
  Building2,
  Globe,
  ListChecks,
  HandCoins,
  Landmark,
  BellRing,
  PartyPopper,
  HeartHandshake,
  MessageSquare,
  Wallet,
  HardDrive,
  CreditCard,
  Users,
  ShieldCheck,
  BadgeCheck,
  UserPlus,
  ScrollText,
  Languages,
  type LucideIcon,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";
import type { TKey } from "@/lib/i18n/translate";

type Need = "settings" | "team" | "finance";
type Item = { labelKey: TKey; href: string; need: Need; icon: LucideIcon };
type Group = { titleKey: TKey; items: Item[] };

const GROUPS: Group[] = [
  {
    titleKey: "settings.sectionChurch",
    items: [
      { labelKey: "settings.general", href: "/settings", need: "settings", icon: Building2 },
      { labelKey: "settings.verification", href: "/settings/verification", need: "settings", icon: BadgeCheck },
      { labelKey: "settings.publicPage", href: "/settings/public", need: "settings", icon: Globe },
      { labelKey: "settings.services", href: "/settings/services", need: "settings", icon: ListChecks },
      { labelKey: "settings.givingCategories", href: "/settings/giving", need: "settings", icon: HandCoins },
      { labelKey: "settings.financeSetup", href: "/settings/finance", need: "finance", icon: Landmark },
      { labelKey: "settings.language", href: "/settings/language", need: "settings", icon: Languages },
    ],
  },
  {
    titleKey: "settings.sectionEngagement",
    items: [
      { labelKey: "settings.reminders", href: "/settings/reminders", need: "settings", icon: BellRing },
      { labelKey: "settings.firstTimers", href: "/settings/first-timers", need: "settings", icon: HeartHandshake },
      { labelKey: "settings.celebrationSettings", href: "/settings/celebrations", need: "settings", icon: PartyPopper },
      { labelKey: "settings.smsSettings", href: "/settings/sms", need: "settings", icon: MessageSquare },
    ],
  },
  {
    titleKey: "settings.sectionBilling",
    items: [
      { labelKey: "settings.wallet", href: "/settings/wallet", need: "settings", icon: Wallet },
      { labelKey: "settings.storage", href: "/settings/storage", need: "settings", icon: HardDrive },
      { labelKey: "settings.planBilling", href: "/settings/billing", need: "settings", icon: CreditCard },
      { labelKey: "settings.referrals", href: "/settings/referrals", need: "settings", icon: Gift },
    ],
  },
  {
    titleKey: "settings.sectionPeople",
    items: [
      { labelKey: "settings.signupLink", href: "/settings/signup", need: "settings", icon: UserPlus },
      { labelKey: "settings.team", href: "/settings/team", need: "team", icon: Users },
      { labelKey: "settings.roles", href: "/settings/roles", need: "team", icon: ShieldCheck },
      { labelKey: "settings.activityLog", href: "/settings/activity", need: "settings", icon: ScrollText },
    ],
  },
];

export function SettingsNav({
  canSettings,
  canTeam,
  canFinance,
}: {
  canSettings: boolean;
  canTeam: boolean;
  canFinance: boolean;
}) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();

  const allow = (need: Need) =>
    need === "settings" ? canSettings : need === "team" ? canTeam : canFinance;
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
          {t("settings.title")}
        </label>
        <Select value={active} onValueChange={(href) => router.push(href)}>
          <SelectTrigger
            aria-label={t("settings.chooseSection")}
            className="bg-background w-full rounded-xl font-medium"
          >
            <SelectValue placeholder={t("settings.chooseSection")} />
          </SelectTrigger>
          <SelectContent searchPlaceholder={t("common.searchPlaceholder")}>
            {groups.map((g) => (
              <SelectGroup key={g.titleKey}>
                <SelectLabel>{t(g.titleKey)}</SelectLabel>
                {g.items.map((i) => (
                  <SelectItem key={i.href} value={i.href}>
                    {t(i.labelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop: grouped vertical nav */}
      <nav className="hidden lg:block">
        <div className="sticky top-6 space-y-5">
          {groups.map((g) => (
            <div key={g.titleKey}>
              <p className="text-muted-foreground mb-1.5 px-3 text-xs font-bold uppercase tracking-wide">
                {t(g.titleKey)}
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
                      {t(i.labelKey)}
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
