import {
  LayoutDashboard,
  ClipboardCheck,
  BarChart3,
  Users,
  UsersRound,
  HeartHandshake,
  HandCoins,
  Bell,
  Settings,
  PlusCircle,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Permission(s) needed to see this. Undefined = always visible. */
  perm?: string | string[];
};

/** Is a nav item visible given the user's permissions? */
export function navAllowed(
  perm: string | string[] | undefined,
  perms: string[],
  isOwner: boolean,
): boolean {
  if (isOwner || !perm) return true;
  const list = Array.isArray(perm) ? perm : [perm];
  return list.some((p) => perms.includes(p));
}

const SETTINGS_PERMS = ["settings.manage", "team.manage"];

/** Full navigation (desktop sidebar). */
export const mainNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  {
    label: "Attendance",
    href: "/attendance",
    icon: ClipboardCheck,
    perm: "attendance.view",
  },
  { label: "Analytics", href: "/analytics", icon: BarChart3, perm: "analytics.view" },
  { label: "Members", href: "/members", icon: Users, perm: "members.view" },
  { label: "Groups", href: "/groups", icon: UsersRound, perm: "groups.view" },
  { label: "Giving", href: "/giving", icon: HandCoins, perm: "giving.view" },
  {
    label: "Follow-up",
    href: "/follow-up",
    icon: HeartHandshake,
    perm: "followup.view",
  },
  { label: "Settings", href: "/settings", icon: Settings, perm: SETTINGS_PERMS },
];

/** The primary fast action — needs permission to record attendance. */
export const recordAction: NavItem = {
  label: "Record",
  href: "/attendance/record",
  icon: PlusCircle,
  perm: "attendance.manage",
};

/** Bottom nav on mobile: 2 left, [Record], then Members + a "More" sheet. */
export const mobileNavLeft: NavItem[] = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard },
  {
    label: "Attendance",
    href: "/attendance",
    icon: ClipboardCheck,
    perm: "attendance.view",
  },
];
export const mobileNavRight: NavItem[] = [
  { label: "Members", href: "/members", icon: Users, perm: "members.view" },
];

/**
 * Grouped menu for the mobile "More" sheet. `tile` holds full literal
 * Tailwind classes (so they aren't purged) for each item's coloured icon.
 */
export type MenuItem = NavItem & { description: string; tile: string };

export const mobileMenuSections: { title: string; items: MenuItem[] }[] = [
  {
    title: "Overview",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        description: "Your church at a glance",
        tile: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
      },
      {
        label: "Analytics",
        href: "/analytics",
        icon: BarChart3,
        description: "Trends & breakdowns",
        tile: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
      },
    ],
  },
  {
    title: "Records",
    items: [
      {
        label: "Attendance",
        href: "/attendance",
        icon: ClipboardCheck,
        description: "Headcounts & history",
        tile: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
        perm: "attendance.view",
      },
      {
        label: "Giving",
        href: "/giving",
        icon: HandCoins,
        description: "Offerings, tithes & donations",
        tile: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        perm: "giving.view",
      },
    ],
  },
  {
    title: "People",
    items: [
      {
        label: "Members",
        href: "/members",
        icon: Users,
        description: "Your congregation",
        tile: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        perm: "members.view",
      },
      {
        label: "Groups",
        href: "/groups",
        icon: UsersRound,
        description: "Ministries & groups",
        tile: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
        perm: "groups.view",
      },
      {
        label: "Follow-up",
        href: "/follow-up",
        icon: HeartHandshake,
        description: "Visitor care",
        tile: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
        perm: "followup.view",
      },
    ],
  },
  {
    title: "Account",
    items: [
      {
        label: "Notifications",
        href: "/notifications",
        icon: Bell,
        description: "Updates from FlockInsight",
        tile: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
      },
      {
        label: "Settings",
        href: "/settings",
        icon: Settings,
        description: "Profile, services & team",
        tile: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
        perm: SETTINGS_PERMS,
      },
    ],
  },
];
