import type { TKey } from "@/lib/i18n/translate";
import {
  PILOT_ONLY,
  isPilot,
  pilotAllows,
  type FeatureKey,
  type PilotMap,
} from "@/lib/entitlements";
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  Database,
  FileText,
  FolderOpen,
  GraduationCap,
  HandCoins,
  Handshake,
  Building2,
  HeartHandshake,
  UserPlus,
  LayoutDashboard,
  LifeBuoy,
  MessagesSquare,
  Network,
  PartyPopper,
  PlusCircle,
  QrCode,
  Radio,
  Settings,
  Users,
  UsersRound,
  Video,
  Wallet,
  Wand2,
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
  /**
   * A module that works and is still being hardened, labelled as such in the
   * menu. Said here rather than in the components so the word cannot drift
   * between the sidebar and the mobile sheet.
   */
  beta?: boolean;
  /**
   * The entitlement this module needs, when it needs one.
   *
   * The menu shows it either way, with the plan's name on it when the church is
   * not on that plan — hiding it would mean a church never discovering what the
   * next tier buys, and clicking through lands on the module with its banner and
   * its records intact rather than on a dead end.
   */
  feature?: FeatureKey;
  /**
   * Belongs in the account menu on desktop, not in the sidebar.
   *
   * Notifications and Settings are about the person and the account rather
   * than about running the church, and a bell already sits in the top bar with
   * the unread count on it. Two permanent rows above the avatar for things
   * nobody opens weekly is two rows the menu could have spent on the work.
   *
   * They stay HERE, in the one list, rather than being deleted from it: the
   * mobile sheet shows them inline, the ⌘K palette finds them by name, and
   * `nav-coverage.test.ts` checks every module is reachable. A module removed
   * from this list to move it somewhere else is precisely how three of them
   * went invisible (see the note further down). Only the desktop sidebar reads
   * this flag, and only to skip the row.
   */
  accountMenu?: boolean;
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

/**
 * Should this entry appear for this church at all?
 *
 * Permission decides as it always has. On top of that, a module being PILOTED
 * somewhere else is hidden rather than shown with an upgrade chip — the chip
 * says "Pro", and during a pilot paying for Pro would not unlock it, so
 * advertising it would be a promise the product cannot keep.
 *
 * Everything else still shows with its chip. A church that could have a module
 * by upgrading should know it exists; that is the chip's whole job.
 */
export function navVisible(
  item: { perm?: string | string[]; feature?: FeatureKey },
  perms: string[],
  isOwner: boolean,
  churchSlug: string | null | undefined,
  /** Injectable so this stays tested when nothing is being piloted. */
  pilots: PilotMap = PILOT_ONLY,
): boolean {
  if (!navAllowed(item.perm, perms, isOwner)) return false;
  if (item.feature && isPilot(item.feature, pilots)) {
    return pilotAllows(item.feature, churchSlug, pilots);
  }
  return true;
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
  "contributions.view",
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

/*
 * `mainNav` used to live here: a second, parallel list of every module, read
 * by nothing at all.
 *
 * It cost three modules. Facilities, First-timers and Livestreams were each
 * added to it and so appeared nowhere in the app — no error, no empty page,
 * just a feature that was not there. Two of them were built, tested, deployed
 * and verified in that state, and the feature flag took the blame.
 *
 * `navSections` below is the only list. The desktop sidebar, the mobile menu
 * and the ⌘K palette all render it, and `nav-coverage.test.ts` fails the build
 * if a module has no way to reach it.
 */

/** The primary fast action — needs permission to record attendance. */
export const recordAction: NavItem = {
  labelKey: "nav.record",
  href: "/attendance/record",
  icon: PlusCircle,
  perm: "attendance.manage",
};

/**
 * Bottom nav on mobile: 2 left, [Record], then Members + a "More" sheet.
 *
 * Five targets and no more, because the bar is also the one row of the screen
 * a thumb can reach without moving the hand. Everything else is in the sheet,
 * which is one tap away and searchable.
 */
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
 * One menu entry. `tile` holds full literal Tailwind classes (so they aren't
 * purged) for the item's coloured icon.
 */
export type MenuItem = NavItem & { descriptionKey: TKey; tile: string };

export type NavSection = {
  titleKey: TKey;
  items: MenuItem[];
  /**
   * Pinned below the scroll area rather than inside it.
   *
   * Exactly one section is, and it is the last one. Help is what somebody
   * reaches for when they are already stuck, and making them scroll past
   * twenty-four modules they did not want in order to find the word "Help" is
   * the moment a church gives up and sends a WhatsApp message instead. The
   * mobile sheet renders it inline at the end, where there is room.
   */
  footer?: boolean;
  /**
   * The first section, which the desktop sidebar draws with no heading and no
   * chevron.
   *
   * Exactly one, and it is first. It holds the dashboard, and the reason it is
   * not simply the top of a group is that it must never be collapsible: it is
   * where the wordmark points, where every sign-in lands, and the one row that
   * has to be visible at a glance however somebody has arranged the rest. A
   * heading over a single row in a 288px column is also twenty pixels spent
   * saying nothing. The mobile sheet does show the heading — there is room,
   * and a headingless block at the top of a sheet reads as detached.
   */
  lead?: boolean;
};

/**
 * The menu.
 *
 * Grouped by the job somebody came to do, not by the shape of the database.
 * The previous grouping had eleven entries under "Records" — Giving beside
 * Media beside QR codes — and nine under "People" that included video
 * meetings. Eleven is past the point where a heading helps: it is a list with
 * a word on top of it, and finding Finance meant reading all eleven.
 *
 * **Doing comes before reading about it.** The order is the argument: home,
 * then the gathering you are recording, then the money you counted, then the
 * people, and only then the analytics and the reports. A church's Sunday is
 * spent writing records down and its Monday is spent looking at them, and
 * there are far more Sundays. The first arrangement had Analytics, Reports and
 * Branches above Attendance and Giving, which put the weekly job fifth and the
 * monthly job first.
 *
 * Nothing is nested two deep — every module is one click from here, which is
 * the one thing a menu this size must not trade away.
 */
export const navSections: NavSection[] = [
  /*
   * Home: one row, no heading on desktop, and never collapsible. See `lead`
   * on NavSection for why it is not simply the first entry of a group.
   */
  {
    titleKey: "nav.sectionHome",
    lead: true,
    items: [
      {
        labelKey: "nav.dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        descriptionKey: "nav.dashboardDesc",
        tile: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
      },
    ],
  },
  {
    titleKey: "nav.sectionGatherings",
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
        labelKey: "nav.events",
        href: "/my-events",
        icon: CalendarDays,
        descriptionKey: "nav.eventsDesc",
        tile: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
        perm: "settings.manage",
      },
      {
        labelKey: "nav.facilities",
        feature: "facilities",
        href: "/facilities",
        icon: Building2,
        descriptionKey: "nav.facilitiesDesc",
        tile: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        perm: "facilities.view",
        beta: true,
      },
      {
        labelKey: "nav.meetings",
        feature: "meetings",
        href: "/meetings",
        icon: Video,
        descriptionKey: "nav.meetingsDesc",
        tile: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
        perm: "meetings.view",
        beta: true,
      },
      {
        labelKey: "nav.livestreams",
        feature: "livestreams",
        href: "/livestreams",
        icon: Radio,
        descriptionKey: "nav.livestreamsDesc",
        tile: "bg-red-500/15 text-red-600 dark:text-red-400",
        perm: "meetings.view",
      },
    ],
  },
  {
    titleKey: "nav.sectionMoney",
    items: [
      {
        labelKey: "nav.giving",
        href: "/giving",
        icon: HandCoins,
        descriptionKey: "nav.givingDesc",
        tile: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        perm: "giving.view",
      },
      {
        labelKey: "nav.contributions",
        href: "/contributions",
        icon: Handshake,
        descriptionKey: "nav.contributionsDesc",
        tile: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        perm: "contributions.view",
      },
      {
        labelKey: "nav.finance",
        feature: "finance",
        href: "/finance",
        icon: Wallet,
        descriptionKey: "nav.financeDesc",
        tile: "bg-lime-500/15 text-lime-600 dark:text-lime-400",
        perm: "finance.view",
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
      /*
       * First-timers directly above Follow-up, and both above Members' other
       * neighbours, because they are one errand: somebody new came on Sunday
       * and has to be called on Tuesday. They were four apart in the old menu,
       * which is part of why churches were registering visitors through
       * Members → Add and losing them (see the note in AGENTS.md).
       */
      {
        labelKey: "nav.firstTimers",
        feature: "followUp",
        href: "/first-timers",
        icon: UserPlus,
        descriptionKey: "nav.firstTimersDesc",
        tile: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
        perm: "followup.view",
      },
      {
        labelKey: "nav.followUp",
        feature: "followUp",
        href: "/follow-up",
        icon: HeartHandshake,
        descriptionKey: "nav.followUpDesc",
        tile: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
        perm: "followup.view",
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
        feature: "training",
        href: "/training",
        icon: GraduationCap,
        descriptionKey: "nav.trainingDesc",
        tile: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
        perm: "training.view",
      },
    ],
  },
  /*
   * Reading what was recorded, which is a different week from recording it —
   * and the reason this group sits below the three above rather than at the
   * top, where it started.
   */
  {
    titleKey: "nav.sectionInsights",
    items: [
      {
        labelKey: "nav.analytics",
        feature: "analytics",
        href: "/analytics",
        icon: BarChart3,
        descriptionKey: "nav.analyticsDesc",
        tile: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
      },
      {
        labelKey: "nav.reports",
        feature: "reports",
        href: "/reports",
        icon: Database,
        descriptionKey: "nav.reportsDesc",
        tile: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
        perm: REPORT_PERMS,
      },
      /*
       * Branches sits with the other ways of looking at the whole church
       * rather than under the account, which is where it used to be. It is not
       * a setting — it is the network seen from above, which is the same
       * question analytics and the reports answer at a smaller scale.
       */
      {
        labelKey: "nav.branches",
        feature: "branches",
        href: "/branches",
        icon: Network,
        descriptionKey: "nav.branchesDesc",
        tile: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
        perm: ["settings.manage", "analytics.view"],
      },
    ],
  },
  {
    titleKey: "nav.sectionOutreach",
    items: [
      {
        labelKey: "nav.communication",
        href: "/communication",
        icon: MessagesSquare,
        descriptionKey: "nav.communicationDesc",
        tile: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
        perm: "communication.view",
      },
      {
        labelKey: "nav.devotionals",
        feature: "devotionals",
        href: "/devotionals",
        icon: BookOpen,
        descriptionKey: "nav.devotionalsDesc",
        tile: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
        perm: "devotionals.view",
      },
      {
        labelKey: "nav.forms",
        feature: "forms",
        href: "/forms",
        icon: FileText,
        descriptionKey: "nav.formsDesc",
        tile: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
        perm: "forms.view",
      },
    ],
  },
  {
    titleKey: "nav.sectionContent",
    items: [
      {
        labelKey: "nav.media",
        href: "/media",
        icon: FolderOpen,
        descriptionKey: "nav.mediaDesc",
        tile: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
        perm: "media.view",
      },
      {
        labelKey: "nav.studio",
        href: "/studio",
        icon: Wand2,
        descriptionKey: "nav.studioDesc",
        tile: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
        perm: "media.view",
      },
      {
        labelKey: "nav.links",
        href: "/links",
        icon: QrCode,
        descriptionKey: "nav.linksDesc",
        tile: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
        perm: "links.view",
      },
    ],
  },
  {
    titleKey: "nav.sectionAccount",
    footer: true,
    items: [
      /*
       * Notifications and Settings are `accountMenu`: the desktop sidebar
       * leaves them to the menu under the avatar, which is where somebody
       * looks for their own account anyway, and the top bar already carries a
       * bell with the unread count on it. They are still listed here, so the
       * phone sheet, the palette and the coverage test all still see them.
       */
      {
        labelKey: "nav.notifications",
        href: "/notifications",
        icon: Bell,
        descriptionKey: "nav.notificationsDesc",
        tile: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
        accountMenu: true,
      },
      {
        labelKey: "nav.settings",
        href: "/settings",
        icon: Settings,
        descriptionKey: "nav.settingsDesc",
        tile: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
        perm: SETTINGS_PERMS,
        accountMenu: true,
      },
      /*
       * Help stays fixed above the avatar, alone. It is the one thing in this
       * group somebody reaches for mid-task, and it is reached for precisely
       * when they are stuck — which is the worst moment to ask them to scroll
       * past twenty-four modules or to guess that it lives behind their own
       * photograph.
       */
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

/**
 * Every entry, in menu order, filtered to what this person may see.
 *
 * One function, used by the sidebar, the mobile sheet, the palette and the
 * quick-access ranking, so "what is in the menu" has exactly one answer. The
 * alternative — each caller flattening and filtering for itself — is how four
 * surfaces end up disagreeing about whether a module exists.
 */
export function visibleNavItems(
  perms: string[],
  isOwner: boolean,
  churchSlug: string | null | undefined,
): MenuItem[] {
  return navSections.flatMap((s) =>
    s.items.filter((i) => navVisible(i, perms, isOwner, churchSlug)),
  );
}

/**
 * What the desktop sidebar pins above the avatar.
 *
 * The footer section minus the rows the account menu has taken, which today
 * leaves Help on its own. A function rather than a filter written into the
 * component, because the mobile sheet must NOT apply it — on a phone there is
 * no sidebar footer and the sheet is the whole menu — and the easiest way to
 * get that wrong is for the rule to live in a component where the next person
 * copies it into the other one.
 */
export function sidebarFooterItems(sections: NavSection[]): MenuItem[] {
  return sections
    .filter((s) => s.footer)
    .flatMap((s) => s.items)
    .filter((i) => !i.accountMenu);
}

/** The sections, each filtered, with the now-empty ones dropped. */
export function visibleNavSections(
  perms: string[],
  isOwner: boolean,
  churchSlug: string | null | undefined,
): NavSection[] {
  return navSections
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => navVisible(i, perms, isOwner, churchSlug)),
    }))
    .filter((s) => s.items.length > 0);
}
