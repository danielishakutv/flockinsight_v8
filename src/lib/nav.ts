import {
  LayoutDashboard,
  ClipboardCheck,
  BarChart3,
  Users,
  Settings,
  PlusCircle,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

/** Full navigation (desktop sidebar). */
export const mainNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Attendance", href: "/attendance", icon: ClipboardCheck },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "Members", href: "/members", icon: Users },
  { label: "Settings", href: "/settings", icon: Settings },
];

/** The primary fast action. */
export const recordAction: NavItem = {
  label: "Record",
  href: "/attendance/record",
  icon: PlusCircle,
};

/** Bottom nav on mobile: 2 left, [Record], 2 right. */
export const mobileNavLeft: NavItem[] = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard },
  { label: "Attendance", href: "/attendance", icon: ClipboardCheck },
];
export const mobileNavRight: NavItem[] = [
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "Members", href: "/members", icon: Users },
];
