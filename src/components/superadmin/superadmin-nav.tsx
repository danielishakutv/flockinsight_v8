"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  BarChart3,
  Bell,
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
  Menu,
  MessageSquare,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  ScrollText,
  ShieldCheck,
  Tag,
  Telescope,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { visibleNav } from "@/lib/platform-permissions";
import {
  NAV_CLOSED_GROUPS_KEY,
  NAV_RAIL_KEY,
  activeHref,
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
  ClipboardList,
  Telescope,
  Building2,
  Church,
  Users,
  LifeBuoy,
  Banknote,
  Tag,
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
      <div className="sticky top-14 overflow-visible px-3 py-4">
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
 * Mobile drawer
 * ========================================================== */

/**
 * The drawer, portalled to <body>.
 *
 * The admin header carries `backdrop-blur`, and a blurred element becomes the
 * containing block for `position: fixed` descendants — so a drawer rendered
 * inside it resolved against the 56px header and opened as an empty sliver.
 * The portal is the fix and must stay.
 */
export function SuperadminMobileNav({ perms }: { perms: string[] }) {
  const [open, setOpen] = useState(false);
  const mounted = useMounted();
  const pathname = usePathname();
  const groups = useGroups(perms);
  const active = activeHref(
    pathname,
    groups.flatMap((g) => g.items.map((i) => i.href)),
  );

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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the menu"
        className="text-muted-foreground hover:text-foreground grid size-11 place-items-center rounded-lg lg:hidden"
      >
        <Menu className="size-5" />
      </button>

      {mounted &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setOpen(false)}
            />
            <div className="bg-background absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r shadow-xl">
              <div className="flex h-14 shrink-0 items-center justify-between border-b px-3">
                <span className="text-sm font-bold">Menu</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close the menu"
                  className="text-muted-foreground hover:text-foreground grid size-11 place-items-center rounded-lg"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div
                className="min-h-0 flex-1 overflow-y-auto px-3 py-4"
                style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
              >
                <NavList
                  groups={groups}
                  active={active}
                  rail={false}
                  onNavigate={() => setOpen(false)}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
