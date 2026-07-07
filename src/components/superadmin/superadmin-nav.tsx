"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  Building2,
  Database,
  Image as ImageIcon,
  LayoutDashboard,
  LifeBuoy,
  MessageSquare,
  Newspaper,
  ScrollText,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const tabs: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Overview", href: "/superadmin", icon: LayoutDashboard },
  { label: "Usage", href: "/superadmin/usage", icon: BarChart3 },
  { label: "Churches", href: "/superadmin/churches", icon: Building2 },
  { label: "Users", href: "/superadmin/users", icon: Users },
  { label: "Notifications", href: "/superadmin/notifications", icon: Bell },
  { label: "SMS", href: "/superadmin/sms", icon: MessageSquare },
  { label: "Pricing", href: "/superadmin/pricing", icon: Tag },
  { label: "Support", href: "/superadmin/support", icon: LifeBuoy },
  { label: "Blog", href: "/superadmin/blog", icon: Newspaper },
  { label: "Banners", href: "/superadmin/banners", icon: ImageIcon },
  { label: "Audit", href: "/superadmin/audit", icon: ScrollText },
  { label: "Backups", href: "/superadmin/backups", icon: Database },
];

export function SuperadminNav() {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <t.icon className="size-4" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
