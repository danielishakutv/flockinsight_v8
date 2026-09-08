"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  Building2,
  Church,
  Database,
  HeartPulse,
  Image as ImageIcon,
  LayoutDashboard,
  LifeBuoy,
  Map,
  Megaphone,
  Menu,
  MessageSquare,
  Newspaper,
  Rocket,
  ScrollText,
  Tag,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Item = { label: string; href: string; icon: LucideIcon };

/**
 * Grouped so the sidebar reads as four jobs rather than sixteen links: what's
 * happening, who's on the platform, how we grow it, and how we run it.
 */
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Platform",
    items: [
      { label: "Overview", href: "/superadmin", icon: LayoutDashboard },
      { label: "Health", href: "/superadmin/health", icon: HeartPulse },
      { label: "Usage", href: "/superadmin/usage", icon: BarChart3 },
    ],
  },
  {
    title: "Customers",
    items: [
      { label: "Churches", href: "/superadmin/churches", icon: Building2 },
      { label: "Denominations", href: "/superadmin/denominations", icon: Church },
      { label: "Users", href: "/superadmin/users", icon: Users },
      { label: "Support", href: "/superadmin/support", icon: LifeBuoy },
    ],
  },
  {
    title: "Product",
    items: [
      { label: "Roadmap", href: "/superadmin/roadmap", icon: Map },
    ],
  },
  {
    title: "Growth",
    items: [
      { label: "Pipeline", href: "/superadmin/growth", icon: Rocket },
      { label: "Outreach", href: "/superadmin/growth/outreach", icon: Megaphone },
      { label: "Notifications", href: "/superadmin/notifications", icon: Bell },
      { label: "Pricing", href: "/superadmin/pricing", icon: Tag },
    ],
  },
  {
    title: "Content & ops",
    items: [
      { label: "Blog", href: "/superadmin/blog", icon: Newspaper },
      { label: "Banners", href: "/superadmin/banners", icon: ImageIcon },
      { label: "SMS", href: "/superadmin/sms", icon: MessageSquare },
      { label: "Audit", href: "/superadmin/audit", icon: ScrollText },
      { label: "Backups", href: "/superadmin/backups", icon: Database },
    ],
  },
];

const ALL_ITEMS = GROUPS.flatMap((g) => g.items);

/** Longest matching href wins, so /growth/outreach doesn't also light /growth. */
function activeHref(pathname: string): string | undefined {
  return ALL_ITEMS.map((i) => i.href)
    .filter((href) =>
      href === "/superadmin" ? pathname === href : pathname.startsWith(href),
    )
    .sort((a, b) => b.length - a.length)[0];
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = activeHref(pathname);

  return (
    <nav className="space-y-5">
      {GROUPS.map((group) => (
        <div key={group.title}>
          <p className="text-muted-foreground/70 px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase">
            {group.title}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const on = active === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                      on
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <item.icon
                      className={cn("size-4 shrink-0", on && "text-primary")}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The fixed sidebar on desktop. */
export function SuperadminSidebar() {
  return (
    <aside className="hidden w-56 shrink-0 border-r lg:block">
      <div className="sticky top-14 px-3 py-5">
        <NavList />
      </div>
    </aside>
  );
}

/**
 * The same list behind a button on small screens.
 *
 * The drawer is rendered through a portal into `document.body` rather than in
 * place. It has to be: this component sits inside the admin header, and that
 * header carries `backdrop-blur`. A `backdrop-filter` makes an element the
 * containing block for every `position: fixed` descendant, so an in-place
 * `fixed inset-0` resolved against the 56px-tall header instead of the
 * viewport — the panel was clipped to a sliver showing only its title and
 * close button, and every nav link was cut off. On a phone that reads as "the
 * menu doesn't open at all". The portal moves the drawer out from under the
 * blur, so `inset-0` means the viewport again.
 */
export function SuperadminMobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const active = activeHref(pathname);
  const current = ALL_ITEMS.find((i) => i.href === active);

  // Close on Escape, and don't let the page behind scroll while it's open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const drawer = (
    <div className="fixed inset-0 z-[60] lg:hidden">
      <button
        type="button"
        aria-label="Close menu"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/40"
      />
      <div className="bg-background absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-bold">Platform admin</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="hover:bg-accent -mr-1 rounded-md p-1.5"
          >
            <X className="size-4" />
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto p-4"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
        >
          <NavList onNavigate={() => setOpen(false)} />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hover:bg-accent flex min-w-0 shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold lg:hidden"
        aria-label="Open admin menu"
        aria-expanded={open}
      >
        <Menu className="size-4 shrink-0" />
        <span className="max-w-[9rem] truncate">
          {current?.label ?? "Menu"}
        </span>
      </button>

      {/* `open` only ever becomes true from a click, so this never runs
          during SSR and `document` is always there when it does. */}
      {open && createPortal(drawer, document.body)}
    </>
  );
}
