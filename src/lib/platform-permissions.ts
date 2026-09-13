/**
 * What someone can do inside /superadmin.
 *
 * Pure — safe to import from a client component. The server-only checks live
 * in platform-access.ts.
 *
 * Until now this was one boolean: `user.is_super_admin`, which meant every
 * admin could delete a church, reset anyone's password and read the whole
 * ledger. That is fine for one person and wrong for a team — a support agent
 * needs the support queue and a church's details, not the backups.
 *
 * The modules here do double duty: they are the permission groups AND the
 * navigation groups, so the menu can never drift from what it is allowed to
 * show. Adding a page means adding it here once.
 */

export type PlatformPermission = string;

export type PlatformPage = {
  label: string;
  href: string;
  /** The permission needed to see this page at all. */
  perm: PlatformPermission;
  /** Lucide icon name, resolved by the nav. */
  icon: string;
};

export type PlatformModule = {
  key: string;
  /** Heading shown above this group in the sidebar. */
  label: string;
  description: string;
  perms: { key: PlatformPermission; label: string; description: string }[];
  pages: PlatformPage[];
};

export const PLATFORM_MODULES: PlatformModule[] = [
  {
    key: "overview",
    label: "Overview",
    description: "How the platform as a whole is doing.",
    perms: [
      {
        key: "platform.overview.view",
        label: "See the dashboard",
        description: "Headline numbers, growth and platform health.",
      },
    ],
    pages: [
      { label: "Dashboard", href: "/superadmin", perm: "platform.overview.view", icon: "LayoutDashboard" },
      { label: "Health", href: "/superadmin/health", perm: "platform.overview.view", icon: "HeartPulse" },
      { label: "Usage", href: "/superadmin/usage", perm: "platform.overview.view", icon: "BarChart3" },
    ],
  },
  {
    key: "customers",
    label: "Customers",
    description: "The churches using FlockInsight, and the people in them.",
    perms: [
      {
        key: "platform.churches.view",
        label: "See churches",
        description: "Church list, details and activity.",
      },
      {
        key: "platform.churches.manage",
        label: "Manage churches",
        description:
          "Create, suspend, verify, change plans, act as a church, and delete.",
      },
      {
        key: "platform.users.view",
        label: "See user accounts",
        description: "Who has a login, and which church they belong to.",
      },
      {
        key: "platform.users.manage",
        label: "Manage user accounts",
        description: "Reset passwords, move people between churches, delete accounts.",
      },
      {
        key: "platform.support.manage",
        label: "Handle support",
        description: "Read and reply to support requests.",
      },
    ],
    pages: [
      { label: "Churches", href: "/superadmin/churches", perm: "platform.churches.view", icon: "Building2" },
      { label: "Denominations", href: "/superadmin/denominations", perm: "platform.churches.view", icon: "Church" },
      { label: "Users", href: "/superadmin/users", perm: "platform.users.view", icon: "Users" },
      { label: "Support", href: "/superadmin/support", perm: "platform.support.manage", icon: "LifeBuoy" },
    ],
  },
  {
    key: "money",
    label: "Money",
    description: "Revenue, wallets, trials, referrals and what we charge.",
    perms: [
      {
        key: "platform.finance.view",
        label: "See the money",
        description: "Revenue, recurring value, wallet float, trials, referrals.",
      },
      {
        key: "platform.finance.manage",
        label: "Move money",
        description:
          "Record payments, adjust wallets, extend advances, change trials.",
      },
      {
        key: "platform.pricing.manage",
        label: "Set pricing",
        description: "Plan prices and the copy on the pricing page.",
      },
    ],
    pages: [
      { label: "Finance", href: "/superadmin/finance", perm: "platform.finance.view", icon: "Banknote" },
      { label: "Pricing", href: "/superadmin/pricing", perm: "platform.pricing.manage", icon: "Tag" },
    ],
  },
  {
    key: "messaging",
    label: "Messaging",
    description: "What we send to churches, and the gateway it goes through.",
    perms: [
      {
        key: "platform.messaging.send",
        label: "Send announcements",
        description: "Write, schedule and send notifications to churches.",
      },
      {
        key: "platform.sms.manage",
        label: "Manage SMS",
        description: "Sender IDs, SMS pricing and church SMS balances.",
      },
    ],
    pages: [
      { label: "Notifications", href: "/superadmin/notifications", perm: "platform.messaging.send", icon: "Bell" },
      { label: "Outreach", href: "/superadmin/growth/outreach", perm: "platform.messaging.send", icon: "Megaphone" },
      { label: "SMS", href: "/superadmin/sms", perm: "platform.sms.manage", icon: "MessageSquare" },
    ],
  },
  {
    key: "growth",
    label: "Growth",
    description: "Churches we are chasing, and what we are building next.",
    perms: [
      {
        key: "platform.growth.manage",
        label: "Manage growth",
        description: "The sales pipeline and the product roadmap.",
      },
    ],
    pages: [
      { label: "Pipeline", href: "/superadmin/growth", perm: "platform.growth.manage", icon: "Rocket" },
      { label: "Roadmap", href: "/superadmin/roadmap", perm: "platform.growth.manage", icon: "Map" },
    ],
  },
  {
    key: "content",
    label: "Content",
    description: "What visitors read on the public site.",
    perms: [
      {
        key: "platform.content.manage",
        label: "Manage content",
        description: "Blog posts and site banners.",
      },
    ],
    pages: [
      { label: "Blog", href: "/superadmin/blog", perm: "platform.content.manage", icon: "Newspaper" },
      { label: "Banners", href: "/superadmin/banners", perm: "platform.content.manage", icon: "ImageIcon" },
    ],
  },
  {
    key: "system",
    label: "System",
    description: "Who can do what here, and the safety net underneath.",
    perms: [
      {
        key: "platform.roles.manage",
        label: "Manage admin roles",
        description:
          "Create roles and decide what each one can reach. Whoever holds this can grant themselves anything.",
      },
      {
        key: "platform.audit.view",
        label: "Read the audit log",
        description: "Every action an admin has taken.",
      },
      {
        key: "platform.backups.manage",
        label: "Backups",
        description: "Take, download and restore database backups.",
      },
    ],
    pages: [
      { label: "Admin roles", href: "/superadmin/roles", perm: "platform.roles.manage", icon: "ShieldCheck" },
      { label: "Audit", href: "/superadmin/audit", perm: "platform.audit.view", icon: "ScrollText" },
      { label: "Backups", href: "/superadmin/backups", perm: "platform.backups.manage", icon: "Database" },
    ],
  },
];

/** Every permission key that exists. */
export const ALL_PLATFORM_PERMISSIONS: PlatformPermission[] =
  PLATFORM_MODULES.flatMap((m) => m.perms.map((p) => p.key));

/**
 * Permissions that let someone widen their own access, directly or not.
 *
 * Managing roles is the obvious one — you can write yourself a new role.
 * Managing users is the quiet one: reset an owner's password and you are them.
 * Restoring a backup rewrites every table including the roles. These are
 * flagged in the UI so handing them out is a decision rather than a tick.
 */
export const ESCALATING_PERMISSIONS: PlatformPermission[] = [
  "platform.roles.manage",
  "platform.users.manage",
  "platform.backups.manage",
];

export function isEscalating(key: PlatformPermission): boolean {
  return ESCALATING_PERMISSIONS.includes(key);
}

/** Does this set of permissions allow `key`? */
export function hasPlatformPerm(
  perms: Iterable<PlatformPermission>,
  key: PlatformPermission,
): boolean {
  for (const p of perms) if (p === key) return true;
  return false;
}

/**
 * The navigation, filtered to what this person can reach.
 *
 * A module with no reachable page is dropped entirely rather than left as an
 * empty heading — a heading with nothing under it reads as something broken.
 */
export function visibleNav(
  perms: Iterable<PlatformPermission>,
): { key: string; label: string; pages: PlatformPage[] }[] {
  const set = new Set(perms);
  return PLATFORM_MODULES.map((m) => ({
    key: m.key,
    label: m.label,
    pages: m.pages.filter((p) => set.has(p.perm)),
  })).filter((m) => m.pages.length > 0);
}

/**
 * Where to send someone who has just signed in.
 *
 * Not everyone can see the dashboard, and bouncing a support agent to a page
 * they are not allowed to open is a loop.
 */
export function landingPage(perms: Iterable<PlatformPermission>): string {
  const nav = visibleNav(perms);
  return nav[0]?.pages[0]?.href ?? "/dashboard";
}

/** Sensible starting points, offered when creating a role. */
export const ROLE_PRESETS: {
  name: string;
  description: string;
  perms: PlatformPermission[];
}[] = [
  {
    name: "Support",
    description: "Answer churches and look things up. Changes nothing that costs money.",
    perms: [
      "platform.overview.view",
      "platform.churches.view",
      "platform.users.view",
      "platform.support.manage",
    ],
  },
  {
    name: "Finance",
    description: "The money, and nothing else.",
    perms: [
      "platform.overview.view",
      "platform.churches.view",
      "platform.finance.view",
      "platform.finance.manage",
      "platform.pricing.manage",
    ],
  },
  {
    name: "Marketing",
    description: "Announcements, the blog, banners and the pipeline.",
    perms: [
      "platform.overview.view",
      "platform.messaging.send",
      "platform.content.manage",
      "platform.growth.manage",
    ],
  },
  {
    name: "Operations",
    description: "Churches, accounts and SMS — the day-to-day running.",
    perms: [
      "platform.overview.view",
      "platform.churches.view",
      "platform.churches.manage",
      "platform.users.view",
      "platform.support.manage",
      "platform.sms.manage",
      "platform.audit.view",
    ],
  },
];
