import type { TKey } from "@/lib/i18n/translate";
import {
  LayoutDashboard,
  ClipboardCheck,
  BarChart3,
  Users,
  UsersRound,
  HeartHandshake,
  HandCoins,
  Wallet,
  MessagesSquare,
  Bell,
  Settings,
  LifeBuoy,
  CalendarDays,
  PlusCircle,
  FolderOpen,
  FileText,
  BookOpen,
  PartyPopper,
  Network,
  Database,
  GraduationCap,
  Video,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  /**
   * A key into the `nav` section of the dictionary, not a label.
   *
   * The English words used to live here, which meant the sidebar was the one
   * part of the app that could not be translated without rewriting the nav.
   * Now `lib/i18n/dictionaries/en.ts` holds the wording and this holds the
   * name of it, so every language gets the same menu.
   */
  labelKey: TKey;
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

/**
 * Anyone who can view any module has something to download. The reports page
 * and every download route re-check per dataset, so this list only decides
 * whether the link is worth showing.
 */
const REPORT_PERMS = [
  "members.view",
  "attendance.view",
  "giving.view",
  "finance.view",
  "groups.view",
  "training.view",
  "meetings.view",
  "followup.view",
  "communication.view",
  "forms.view",
  "devotionals.view",
  "media.view",
  "settings.manage",
  "team.manage",
];

/** Full navigation (desktop sidebar). */
export const mainNav: NavItem[] = [
  { labelKey: "nav.dashboard", href: "/dashboard", icon: LayoutDashboard },
  {
    labelKey: "nav.attendance",
    href: "/attendance",
    icon: ClipboardCheck,
    perm: "attendance.view",
  },
  { labelKey: "nav.analytics", href: "/analytics", icon: BarChart3, perm: "analytics.view" },
  { labelKey: "nav.members", href: "/members", icon: Users, perm: "members.view" },
  { labelKey: "nav.groups", href: "/groups", icon: UsersRound, perm: "groups.view" },
  { labelKey: "nav.celebrations", href: "/celebrations", icon: PartyPopper, perm: "members.view" },
  {
    labelKey: "nav.training",
    href: "/training",
    icon: GraduationCap,
    perm: "training.view",
  },
  { labelKey: "nav.meetings", href: "/meetings", icon: Video, perm: "meetings.view" },
  { labelKey: "nav.giving", href: "/giving", icon: HandCoins, perm: "giving.view" },
  { labelKey: "nav.finance", href: "/finance", icon: Wallet, perm: "finance.view" },
  {
    labelKey: "nav.followUp",
    href: "/follow-up",
    icon: HeartHandshake,
    perm: "followup.view",
  },
  { labelKey: "nav.media", href: "/media", icon: FolderOpen, perm: "media.view" },
  { labelKey: "nav.forms", href: "/forms", icon: FileText, perm: "forms.view" },
  {
    labelKey: "nav.devotionals",
    href: "/devotionals",
    icon: BookOpen,
    perm: "devotionals.view",
  },
  {
    labelKey: "nav.branches",
    href: "/branches",
    icon: Network,
    perm: ["settings.manage", "analytics.view"],
  },
  { labelKey: "nav.reports", href: "/reports", icon: Database, perm: REPORT_PERMS },
  { labelKey: "nav.settings", href: "/settings", icon: Settings, perm: SETTINGS_PERMS },
];

/** The primary fast action — needs permission to record attendance. */
export const recordAction: NavItem = {
  labelKey: "nav.record",
  href: "/attendance/record",
  icon: PlusCircle,
  perm: "attendance.manage",
};

/** Bottom nav on mobile: 2 left, [Record], then Members + a "More" sheet. */
export const mobileNavLeft: NavItem[] = [
  { labelKey: "nav.home", href: "/dashboard", icon: LayoutDashboard },
  {
    labelKey: "nav.attendance",
    href: "/attendance",
    icon: ClipboardCheck,
    perm: "attendance.view",
  },
];
export const mobileNavRight: NavItem[] = [
  { labelKey: "nav.members", href: "/members", icon: Users, perm: "members.view" },
];

/**
 * Grouped menu for the mobile "More" sheet. `tile` holds full literal
 * Tailwind classes (so they aren't purged) for each item's coloured icon.
 */
export type MenuItem = NavItem & { descriptionKey: TKey; tile: string };

export const mobileMenuSections: { titleKey: TKey; items: MenuItem[] }[] = [
  {
    titleKey: "nav.sectionOverview",
    items: [
      {
        labelKey: "nav.dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        descriptionKey: "nav.dashboardDesc",
        tile: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
      },
      {
        labelKey: "nav.analytics",
        href: "/analytics",
        icon: BarChart3,
        descriptionKey: "nav.analyticsDesc",
        tile: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
      },
      {
        labelKey: "nav.reports",
        href: "/reports",
        icon: Database,
        descriptionKey: "nav.reportsDesc",
        tile: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
        perm: REPORT_PERMS,
      },
    ],
  },
  {
    titleKey: "nav.sectionRecords",
    items: [
      {
        labelKey: "nav.attendance",
        href: "/attendance",
        icon: ClipboardCheck,
        descriptionKey: "nav.attendanceDesc",
        tile: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
        perm: "attendance.view",
      },
      {
        labelKey: "nav.giving",
        href: "/giving",
        icon: HandCoins,
        descriptionKey: "nav.givingDesc",
        tile: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        perm: "giving.view",
      },
      {
        labelKey: "nav.finance",
        href: "/finance",
        icon: Wallet,
        descriptionKey: "nav.financeDesc",
        tile: "bg-lime-500/15 text-lime-600 dark:text-lime-400",
        perm: "finance.view",
      },
      {
        labelKey: "nav.events",
        href: "/my-events",
        icon: CalendarDays,
        descriptionKey: "nav.eventsDesc",
        tile: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
        perm: "settings.manage",
      },
      {
        labelKey: "nav.media",
        href: "/media",
        icon: FolderOpen,
        descriptionKey: "nav.mediaDesc",
        tile: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
        perm: "media.view",
      },
      {
        labelKey: "nav.forms",
        href: "/forms",
        icon: FileText,
        descriptionKey: "nav.formsDesc",
        tile: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
        perm: "forms.view",
      },
      {
        labelKey: "nav.devotionals",
        href: "/devotionals",
        icon: BookOpen,
        descriptionKey: "nav.devotionalsDesc",
        tile: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
        perm: "devotionals.view",
      },
    ],
  },
  {
    titleKey: "nav.sectionPeople",
    items: [
      {
        labelKey: "nav.members",
        href: "/members",
        icon: Users,
        descriptionKey: "nav.membersDesc",
        tile: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        perm: "members.view",
      },
      {
        labelKey: "nav.groups",
        href: "/groups",
        icon: UsersRound,
        descriptionKey: "nav.groupsDesc",
        tile: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
        perm: "groups.view",
      },
      {
        labelKey: "nav.celebrations",
        href: "/celebrations",
        icon: PartyPopper,
        descriptionKey: "nav.celebrationsDesc",
        tile: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
        perm: "members.view",
      },
      {
        labelKey: "nav.training",
        href: "/training",
        icon: GraduationCap,
        descriptionKey: "nav.trainingDesc",
        tile: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
        perm: "training.view",
      },
      {
        labelKey: "nav.meetings",
        href: "/meetings",
        icon: Video,
        descriptionKey: "nav.meetingsDesc",
        tile: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
        perm: "meetings.view",
      },
      {
        labelKey: "nav.followUp",
        href: "/follow-up",
        icon: HeartHandshake,
        descriptionKey: "nav.followUpDesc",
        tile: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
        perm: "followup.view",
      },
      {
        labelKey: "nav.communication",
        href: "/communication",
        icon: MessagesSquare,
        descriptionKey: "nav.communicationDesc",
        tile: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
        perm: "communication.view",
      },
    ],
  },
  {
    titleKey: "nav.sectionAccount",
    items: [
      {
        labelKey: "nav.notifications",
        href: "/notifications",
        icon: Bell,
        descriptionKey: "nav.notificationsDesc",
        tile: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
      },
      {
        labelKey: "nav.branches",
        href: "/branches",
        icon: Network,
        descriptionKey: "nav.branchesDesc",
        tile: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
        perm: ["settings.manage", "analytics.view"],
      },
      {
        labelKey: "nav.settings",
        href: "/settings",
        icon: Settings,
        descriptionKey: "nav.settingsDesc",
        tile: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
        perm: SETTINGS_PERMS,
      },
      {
        labelKey: "nav.help",
        href: "/help",
        icon: LifeBuoy,
        descriptionKey: "nav.helpDesc",
        tile: "bg-green-500/15 text-green-600 dark:text-green-400",
      },
    ],
  },
];
