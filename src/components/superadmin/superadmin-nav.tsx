"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  Banknote,
  BarChart3,
  Bell,
  Bot,
  Building2,
  ChevronDown,
  Church,
  ClipboardList,
  Database,
  Handshake,
  HeartPulse,
  Image as ImageIcon,
  LayoutDashboard,
  LifeBuoy,
  Map,
  Megaphone,
  MessageSquare,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Layers,
  Tag,
  Telescope,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { visibleNav } from "@/lib/platform-permissions";
import {
  NAV_CLOSED_GROUPS_KEY,
  NAV_RAIL_KEY,
  BOTTOM_TAB_LABELS,
  activeHref,
  bottomTabs,
  parseStored,
  resolveOpenGroups,
  toggleClosed,
  type NavGroup,
} from "@/lib/admin-nav";
import { useMounted, useStoredValue, writeStoredValue } from "@/lib/client-state";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  HeartPulse,
  Handshake,
  BarChart3,
  Bot,
  ClipboardList,
  Telescope,
  Building2,
  Church,
  Users,
  LifeBuoy,
  Banknote,
  Tag,
  Layers,
  Bell,
  Megaphone,
  MessageSquare,
  Rocket,
  Map,
  Newspaper,
  ImageIcon,
  ShieldCheck,
  ScrollText,
  Database,
  Sparkles,
};

type Item = { label: string; href: string; icon: LucideIcon };
type Group = { title: string; items: Item[] };

/**
 * The sidebar is built from the permission catalogue, not from a list kept
 * beside it.
 *
 * Two lists drift: a page gets added to the menu and not to the permissions,
 * or a permission is revoked and the link stays there to give a redirect.
 * Here the groups ARE the permission modules, and `visibleNav` has already
 * dropped anything this admin cannot open.
 */
function useGroups(perms: string[]): Group[] {
  return useMemo(
    () =>
      visibleNav(perms).map((m) => ({
        title: m.label,
        items: m.pages.map((pg) => ({
          label: pg.label,
          href: pg.href,
          icon: ICONS[pg.icon] ?? LayoutDashboard,
        })),
      })),
    [perms],
  );
}

/* ============================================================
 * One link
 * ========================================================== */

/**
 * A nav link, in either of the sidebar's two widths.
 *
 * In the rail the label is still in the DOM and still the link's accessible
 * name — it is only visually replaced by a flyout that appears on hover and on
 * keyboard focus. A rail whose labels exist only on hover is unusable to
 * anyone navigating by keyboard, and unreadable to a screen reader.
 */
function NavLink({
  item,
  active,
  rail,
  onNavigate,
}: {
  item: Item;
  active: boolean;
  rail: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={rail ? item.label : undefined}
      className={cn(
        "group/link relative flex items-center rounded-lg text-[13px] font-medium transition-colors",
        rail ? "justify-center p-2" : "gap-2.5 px-2.5 py-2",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <item.icon className="size-4 shrink-0" />
      <span className={cn("truncate", rail && "sr-only")}>{item.label}</span>

      {rail && (
        /*
          The flyout. Rendered inside the link so hover and focus both reveal
          it without a scrap of javascript, and marked aria-hidden because the
          sr-only label above is already the accessible name — announcing both
          would read the item twice.
        */
        <span
          aria-hidden
          className="bg-popover text-popover-foreground pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-semibold shadow-md group-hover/link:block group-focus-visible/link:block"
        >
          {item.label}
        </span>
      )}
    </Link>
  );
}

/* ============================================================
 * The list
 * ========================================================== */

function NavList({
  groups,
  active,
  rail,
  onNavigate,
}: {
  groups: Group[];
  active: string | undefined;
  rail: boolean;
  onNavigate?: () => void;
}) {
  const navGroups: NavGroup[] = useMemo(
    () => groups.map((g) => ({ title: g.title, hrefs: g.items.map((i) => i.href) })),
    [groups],
  );

  /*
   * Read through the store rather than into state. It returns null on the
   * server and during hydration, so the markup matches, and it updates in
   * every tab at once — collapse a group on one screen and the other agrees.
   */
  const raw = useStoredValue(NAV_CLOSED_GROUPS_KEY);
  const closed = useMemo(() => parseStored<string[]>(raw, []), [raw]);

  const open = resolveOpenGroups(navGroups, closed, active);

  const toggle = (title: string) =>
    writeStoredValue(NAV_CLOSED_GROUPS_KEY, JSON.stringify(toggleClosed(closed, title)));

  /*
   * In the rail there is nowhere to put a group heading and nothing to click
   * to expand — so groups become a hairline rule and every item is shown. A
   * collapsed group inside a collapsed sidebar would be a menu item hidden
   * behind two separate things, neither of them visible.
   */
  if (rail) {
    return (
      <nav className="space-y-1">
        {groups.map((group, i) => (
          <div key={group.title}>
            {i > 0 && <div className="bg-border/70 mx-auto my-2 h-px w-6" />}
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink
                    item={item}
                    active={active === item.href}
                    rail
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    );
  }

  return (
    <nav className="space-y-1">
      {groups.map((group) => {
        const isOpen = open.has(group.title);
        const panelId = `nav-${group.title.toLowerCase().replace(/\W+/g, "-")}`;
        return (
          <div key={group.title}>
            <button
              type="button"
              onClick={() => toggle(group.title)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="text-muted-foreground/70 hover:text-foreground flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase transition-colors"
            >
              {group.title}
              <ChevronDown
                aria-hidden
                className={cn(
                  "size-3.5 transition-transform duration-200 motion-reduce:transition-none",
                  !isOpen && "-rotate-90",
                )}
              />
            </button>

            <div
              id={panelId}
              inert={!isOpen}
              className={cn(
                "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="overflow-hidden">
                <ul className="space-y-0.5 pb-1">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <NavLink
                        item={item}
                        active={active === item.href}
                        rail={false}
                        onNavigate={onNavigate}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/* ============================================================
 * Desktop sidebar
 * ========================================================== */

/** The fixed sidebar on desktop, full width or a rail of icons. */
export function SuperadminSidebar({ perms }: { perms: string[] }) {
  const pathname = usePathname();
  const groups = useGroups(perms);
  const active = activeHref(
    pathname,
    groups.flatMap((g) => g.items.map((i) => i.href)),
  );

  const railRaw = useStoredValue(NAV_RAIL_KEY);
  const rail = parseStored<boolean>(railRaw, false);
  const toggleRail = () => writeStoredValue(NAV_RAIL_KEY, JSON.stringify(!rail));

  return (
    <aside
      data-rail={rail ? "" : undefined}
      className={cn(
        "hidden shrink-0 border-r transition-[width] duration-200 ease-out motion-reduce:transition-none lg:block",
        rail ? "w-[4.25rem]" : "w-56",
      )}
    >
      {/*
        overflow-visible, deliberately: the rail's hover labels sit outside the
        sidebar's own width, and a scroll container here would clip every one
        of them.
      */}
      <div className="sticky top-[calc(env(safe-area-inset-top)+3.5rem)] overflow-visible px-3 py-4">
        <NavList groups={groups} active={active} rail={rail} />

        <button
          type="button"
          onClick={toggleRail}
          aria-label={rail ? "Expand the menu" : "Collapse the menu to icons"}
          aria-pressed={rail}
          className={cn(
            "text-muted-foreground hover:bg-accent hover:text-foreground mt-3 flex items-center rounded-lg py-2 text-[13px] font-medium transition-colors",
            rail ? "w-full justify-center" : "w-full gap-2.5 px-2.5",
          )}
        >
          {rail ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <>
              <PanelLeftClose className="size-4" />
              Collapse
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

/* ============================================================
 * Phone: the bottom bar and its "More" sheet
 * ========================================================== */

/** Opens the command palette, which listens for ⌘K / Ctrl+K. */
function openSearch() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
}

function BarTab({
  item,
  label,
  active,
}: {
  item: Item;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-semibold transition-colors",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <item.icon className={cn("size-6 shrink-0", active && "fill-primary/10")} />
      <span className="max-w-full truncate px-0.5">{label}</span>
    </Link>
  );
}

function MoreGlyph({ active }: { active: boolean }) {
  return (
    <span aria-hidden className="grid size-6 grid-cols-2 gap-1 p-1">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn("rounded-[2px]", active ? "bg-primary" : "bg-muted-foreground")}
        />
      ))}
    </span>
  );
}

/**
 * Below lg, the admin is driven from the bottom of the screen, as the church
 * app is: the three pages an operator reaches for, Search in the middle (the
 * command palette — churches, people and pages, which had no way in on a phone
 * because the header's Search button is hidden there) and More for the whole
 * menu. The menu used to be a ☰ in the header, at the top of a tall phone and,
 * on an installed iPhone app, right under the clock.
 *
 * The sheet is portalled to <body>. The bar carries `backdrop-blur`, and a
 * blurred element becomes the containing block for `position: fixed`
 * descendants — a sheet rendered inside it resolved against the bar and
 * opened as a sliver (it happened to the old drawer inside the header). The
 * portal must stay.
 */
export function SuperadminBottomNav({ perms }: { perms: string[] }) {
  const [open, setOpen] = useState(false);
  const mounted = useMounted();
  const pathname = usePathname();
  const groups = useGroups(perms);
  const items = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const active = activeHref(
    pathname,
    items.map((i) => i.href),
  );

  const tabs = useMemo(() => {
    // A find, not a Map: `Map` here is the lucide icon imported above.
    return bottomTabs(items.map((i) => i.href)).flatMap((href) => {
      const item = items.find((i) => i.href === href);
      return item ? [{ item, label: BOTTOM_TAB_LABELS[href] ?? item.label }] : [];
    });
  }, [items]);
  const left = tabs.slice(0, 2);
  const right = tabs.slice(2);
  // More lights up for any page that is not one of the tabs.
  const moreActive =
    open ||
    pathname === "/superadmin/profile" ||
    (!!active && !tabs.some((t) => t.item.href === active));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <nav
        aria-label="Admin menu"
        className="bg-background/90 fixed inset-x-0 bottom-0 z-30 flex items-end border-t backdrop-blur lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex min-w-0 flex-1 items-stretch">
          {left.map((t) => (
            <BarTab key={t.item.href} item={t.item} label={t.label} active={active === t.item.href} />
          ))}
        </div>

        <div className="flex w-20 shrink-0 justify-center">
          <button
            type="button"
            onClick={openSearch}
            aria-label="Search churches, people and pages"
            className="border-background bg-primary text-primary-foreground -mt-6 grid size-16 place-items-center rounded-full border-4 shadow-lg transition-transform active:scale-95 motion-reduce:transition-none"
          >
            <Search className="size-7" strokeWidth={2.5} />
          </button>
        </div>

        <div className="flex min-w-0 flex-1 items-stretch">
          {right.map((t) => (
            <BarTab key={t.item.href} item={t.item} label={t.label} active={active === t.item.href} />
          ))}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="More"
            aria-expanded={open}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-semibold transition-colors",
              moreActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <MoreGlyph active={moreActive} />
            <span className="max-w-full truncate px-0.5">More</span>
          </button>
        </div>
      </nav>

      {mounted &&
        open &&
        createPortal(
          <div className="lg:hidden">
            <button
              type="button"
              aria-label="Close the menu"
              onClick={close}
              className="animate-in fade-in fixed inset-0 z-40 bg-black/50 backdrop-blur-sm duration-200 motion-reduce:animate-none"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Admin menu"
              className="bg-background animate-in slide-in-from-bottom-6 fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-3xl border-t shadow-2xl duration-200 motion-reduce:animate-none"
            >
              <div className="bg-muted mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full" />
              <div className="flex shrink-0 items-center justify-between px-5 pt-3 pb-2">
                <p className="text-xl font-extrabold tracking-tight">Menu</p>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close the menu"
                  className="text-muted-foreground hover:text-foreground grid size-11 place-items-center rounded-lg"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div
                className="min-h-0 flex-1 overflow-y-auto px-3 pt-1"
                style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
              >
                <NavList groups={groups} active={active} rail={false} onNavigate={close} />
                {/* The header hides these two below sm to keep the bar on one
                    line, so on a phone this is the only way to them. */}
                <ul className="mt-3 space-y-0.5 border-t pt-3 sm:hidden">
                  <li>
                    <NavLink
                      item={{ label: "Your profile", href: "/superadmin/profile", icon: UserRound }}
                      active={pathname === "/superadmin/profile"}
                      rail={false}
                      onNavigate={close}
                    />
                  </li>
                  <li>
                    <NavLink
                      item={{ label: "Back to app", href: "/dashboard", icon: ArrowUpRight }}
                      active={false}
                      rail={false}
                      onNavigate={close}
                    />
                  </li>
                </ul>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
