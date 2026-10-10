"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Church,
  Crosshair,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Sparkles,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  sidebarFooterItems,
  visibleNavSections,
  type MenuItem,
  type NavSection,
} from "@/lib/nav";
import { railCookieString } from "@/lib/nav-rail";
import {
  CLOSED_GROUPS_KEY,
  GROUP_MODE_KEY,
  QUICK_ACCESS_MAX,
} from "@/lib/nav-prefs";
import {
  allClosed,
  parseGroupMode,
  parseStored,
  resolveOpenGroups,
  toggleClosed,
  type GroupMode,
  type NavGroup,
} from "@/lib/nav-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HINT_KEY, navKeyHints } from "@/lib/nav-hints";
import { useMounted, useStoredValue, writeStoredValue } from "@/lib/client-state";
import { Logo } from "@/components/brand";
import { UserMenu } from "@/components/app/user-menu";
import { useT } from "@/components/i18n-provider";
import { BetaBadge } from "@/components/beta-badge";
import { PlanChip } from "@/components/app/plan-chip";
import { useQuickAccess, type QuickAccessRow } from "@/components/app/nav-visits";
import { TOGGLE_SIDEBAR_EVENT } from "@/lib/nav-events";
import { keyLabel } from "@/lib/shortcuts";
import { useIsMac } from "@/lib/use-is-mac";

/* ================================================================== *
 * Where we are
 * ================================================================== */

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

/** The one lit entry: the longest match, so /first-timers never lights Members. */
function activeHref(pathname: string, hrefs: string[]): string | undefined {
  return hrefs
    .filter((href) => isActive(pathname, href))
    .sort((a, b) => b.length - a.length)[0];
}

/* ================================================================== *
 * The rail's hover label
 * ================================================================== */

type Flyout = {
  label: string;
  description: string;
  /** The keys for this destination, one label per press, when it has any. */
  hint?: string[];
  top: number;
  left: number;
};

/**
 * One floating label for the whole rail, portalled to `<body>`.
 *
 * The obvious implementation — an absolutely positioned `<span>` inside each
 * link, revealed by `group-hover` with no javascript at all — is what the
 * superadmin rail does, and it works there because that sidebar does not
 * scroll. This one has twenty-seven entries and must; and the instant a
 * container is `overflow-y: auto`, the other axis computes to `auto` too, so
 * every label would be clipped at the sidebar's own 68px edge. There is no CSS
 * way out of that, which is why there is javascript here.
 *
 * `aria-hidden`, and positioned from the link's own rectangle. Each link keeps
 * its real text in the DOM as `sr-only`, so this is purely something to look
 * at: the accessible name, the keyboard order and the screen reader are all
 * served by the markup whether this renders or not.
 */
function RailFlyout({ flyout }: { flyout: Flyout | null }) {
  const mounted = useMounted();
  if (!mounted || !flyout) return null;
  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed z-[60] max-w-60"
      style={{ top: flyout.top, left: flyout.left }}
    >
      <div className="bg-popover text-popover-foreground animate-in fade-in slide-in-from-left-1 rounded-lg border px-3 py-2 shadow-lg duration-100 motion-reduce:animate-none">
        <p className="flex items-center gap-2 text-sm leading-tight font-semibold">
          <span>{flyout.label}</span>
          {/*
            The chord, where the rail is the one place it can be read at all:
            there is no row to print it on, and somebody who has collapsed the
            menu to icons is exactly the person who would rather press a key.
          */}
          {flyout.hint && flyout.hint.length > 0 && (
            <span className="flex shrink-0 items-center gap-0.5">
              {flyout.hint.map((k) => (
                <kbd key={k} className={HINT_KEY}>
                  {k}
                </kbd>
              ))}
            </span>
          )}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-tight">
          {flyout.description}
        </p>
      </div>
    </div>,
    document.body,
  );
}

/** Position a flyout beside an element, kept inside the viewport. */
function flyoutFor(
  el: HTMLElement,
  label: string,
  description: string,
  hint?: string[],
): Flyout {
  const r = el.getBoundingClientRect();
  // ~68px of guessed height for a two-line card; enough to stop the last item
  // in a long rail opening its label off the bottom of the screen.
  const top = Math.min(Math.max(8, r.top - 6), window.innerHeight - 76);
  return { label, description, hint, top, left: r.right + 10 };
}

/* ================================================================== *
 * One row
 * ================================================================== */

/**
 * A menu entry, in either width.
 *
 * The pin lives beside the link rather than inside it: a `<button>` nested in
 * an `<a>` is invalid HTML and behaves differently in every browser. So the
 * row is a container, the link fills it, and the pin is laid over its right
 * edge — which also means the pin can be reached by Tab in its own right.
 */
/**
 * The pin, and what it does when there is no room left.
 *
 * Quick access holds four. The press used to be swallowed at the cap — the
 * list was re-sliced to its first four and nothing changed on screen — so the
 * only way to learn the limit existed was to press a fifth pin twice and
 * conclude the button was broken. Three things carry the refusal now, because
 * each one reaches a different person:
 *
 *  - the **name keeps the module in it**. "Quick access holds 4" on its own
 *    would be the accessible name of all twenty-three unpinned pins at once,
 *    so a screen reader's button list could no longer tell which pin pins
 *    what. The reason is appended to the name, not substituted for it.
 *  - `aria-disabled`, not `disabled`, so the control stays in the tab order
 *    and keeps showing its own tooltip. A `disabled` button is skipped by the
 *    keyboard and, in several browsers, stops rendering `title` — the one
 *    moment it has something to say would be the moment it went quiet.
 *  - a **toast on the press**, which is the only one of the three that works
 *    on a touch screen. There is no hover there and the greyer pin is a
 *    colour step nobody can be expected to notice, so without it the tap
 *    would be exactly the silent nothing this set out to remove.
 */
function PinButton({
  pinned,
  full,
  label,
  onPin,
  className,
}: {
  pinned: boolean;
  full?: boolean;
  label: string;
  onPin: () => void;
  className?: string;
}) {
  const t = useT();
  const blocked = !pinned && !!full;
  const name = pinned
    ? t("nav.unpin", { name: label })
    : t("nav.pin", { name: label });
  const why = t("nav.quickFull", { max: String(QUICK_ACCESS_MAX) });
  const title = blocked ? `${name} — ${why}` : name;
  return (
    <button
      type="button"
      onClick={() => {
        if (blocked) {
          toast(why);
          return;
        }
        onPin();
      }}
      aria-pressed={pinned}
      aria-disabled={blocked || undefined}
      aria-label={title}
      title={title}
      className={cn(
        "focus-visible:ring-ring grid place-items-center rounded-md transition focus-visible:ring-2 focus-visible:opacity-100 focus-visible:outline-none",
        blocked
          ? "text-muted-foreground/40 cursor-not-allowed"
          : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent",
        className,
      )}
    >
      <Pin className={cn("size-3.5", pinned && "fill-current")} />
    </button>
  );
}

function NavRow({
  item,
  active,
  rail,
  pinned,
  pinFull,
  plan,
  hint,
  onPin,
  onNavigate,
  onFlyout,
}: {
  item: MenuItem;
  active: boolean;
  rail: boolean;
  pinned: boolean;
  /**
   * Quick access already holds its four. Only affects an UNpinned row: taking
   * a pin off is never refused.
   */
  pinFull?: boolean;
  plan: string;
  /** The keys that open this page, one label per press, already platformed. */
  hint?: string[];
  onPin?: () => void;
  onNavigate?: () => void;
  onFlyout?: (f: Flyout | null) => void;
}) {
  const t = useT();
  const label = t(item.labelKey);
  const description = t(item.descriptionKey);

  const show = useCallback(
    (e: { currentTarget: HTMLElement }) => {
      if (rail && onFlyout)
        onFlyout(flyoutFor(e.currentTarget, label, description, hint));
    },
    [rail, onFlyout, label, description, hint],
  );
  const hide = useCallback(() => onFlyout?.(null), [onFlyout]);

  return (
    <div className="group/row relative">
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        onPointerEnter={show}
        onFocus={show}
        onPointerLeave={hide}
        onBlur={hide}
        className={cn(
          "relative flex items-center rounded-xl transition-colors",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
          rail ? "justify-center p-1.5" : "gap-2.5 px-2 py-1.5",
          active ? "bg-primary/10" : "hover:bg-sidebar-accent",
        )}
      >
        {/*
          The lit bar. In the rail it is the ONLY thing saying where you are —
          there is no text to colour — so it is drawn the same way in both
          widths rather than being an expanded-only flourish.
        */}
        {active && (
          <span
            aria-hidden
            className={cn(
              "bg-primary absolute top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full",
              // Pulled out to the sidebar's own edge, so the offset has to
              // match the padding the list is sitting in. At -left-3 inside
              // the rail's px-2 it lands at x=-4 and the scroll container
              // clips it away entirely -- which costs the rail the only thing
              // it has to say where you are, since there is no text to colour.
              rail ? "-left-2" : "-left-3",
            )}
          />
        )}
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg transition-colors",
            active ? "bg-primary text-primary-foreground" : item.tile,
          )}
        >
          <item.icon className="size-[18px]" strokeWidth={2.1} />
        </span>

        <span
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 text-sm leading-tight font-semibold",
            rail && "sr-only",
            active ? "text-primary" : "text-sidebar-foreground/90",
          )}
        >
          <span className="truncate">{label}</span>
          {item.beta && <BetaBadge />}
          {item.feature && <PlanChip feature={item.feature} plan={plan} />}
        </span>

        {/*
          The chord, printed on the row.

          Thirteen of these pages have a two-key shortcut and the only way to
          learn that used to be pressing `?` — which nobody does unless they
          already suspect the keys exist. Printed here, somebody who opens
          Members with the mouse every day reads "G M" every day.

          It fades out on hover because the pin button occupies the same
          corner, and the two must never be on top of each other. That is the
          right way round: the hint is for scanning the menu, and by the time
          the pointer is on one row the person has stopped scanning.
        */}
        {!rail && hint && hint.length > 0 && (
          <span
            aria-hidden
            className={cn(
              "flex shrink-0 items-center gap-0.5 transition-opacity duration-100 motion-reduce:transition-none",
              pinned
                ? "opacity-0"
                : "opacity-100 group-hover/row:opacity-0 group-focus-within/row:opacity-0",
            )}
          >
            {hint.map((k) => (
              <kbd key={k} className={HINT_KEY}>
                {k}
              </kbd>
            ))}
          </span>
        )}
      </Link>

      {/*
        Pinning, in the expanded menu only.

        A rail row is 56px of icon with no room for a second target, and a
        control that only exists at one width is better than one that exists at
        both and is unhittable at one of them.
      */}
      {!rail && onPin && (
        <PinButton
          pinned={pinned}
          full={pinFull}
          label={label}
          onPin={onPin}
          className={cn(
            "absolute top-1/2 right-1 size-7 -translate-y-1/2",
            // Hidden until the row is hovered, so twenty-four pins are not
            // competing with twenty-four labels. Always visible once pinned,
            // because that is the only thing saying it is.
            pinned ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
          )}
        />
      )}
    </div>
  );
}

/* ================================================================== *
 * Quick access
 * ================================================================== */

/**
 * The shortcut rows at the top — what they pinned, then where they keep going.
 *
 * Deliberately labelled, and the guessed rows are deliberately distinguishable
 * from the pinned ones. A block of links that silently rearranges itself is
 * disorienting in a way a labelled one is not: "Quick access" plus a pin on
 * the rows somebody chose is the difference between a menu that learns and a
 * menu that moves.
 */
function QuickAccessBlock({
  rows,
  pathname,
  rail,
  plan,
  hints,
  onToggle,
  onDismiss,
  onNavigate,
  onFlyout,
}: {
  rows: QuickAccessRow[];
  pathname: string;
  rail: boolean;
  plan: string;
  hints: Record<string, string[]>;
  onToggle: (href: string) => void;
  onDismiss: (href: string) => void;
  onNavigate?: () => void;
  onFlyout?: (f: Flyout | null) => void;
}) {
  const t = useT();
  if (rows.length === 0) return null;

  return (
    <div className={cn("mb-2", rail ? "pb-2" : "pb-1")}>
      {rail ? (
        <div className="mb-2 flex justify-center" title={t("nav.quickAccess")}>
          <Sparkles aria-hidden className="text-primary/60 size-3.5" />
          <span className="sr-only">{t("nav.quickAccess")}</span>
        </div>
      ) : (
        <p className="text-sidebar-foreground/45 mb-1 flex items-center gap-1.5 px-2 text-[10px] font-bold tracking-wider uppercase">
          <Sparkles aria-hidden className="size-3" />
          {t("nav.quickAccess")}
        </p>
      )}

      <div className="space-y-0.5">
        {rows.map((row) => (
          <div key={row.href} className="group/quick relative">
            <NavRow
              item={row.item}
              active={isActive(pathname, row.href)}
              rail={rail}
              pinned={row.pinned}
              plan={plan}
              hint={hints[row.href]}
              onNavigate={onNavigate}
              onFlyout={onFlyout}
            />
            {!rail && (
              <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center">
                {/*
                  The same control as every other row's, so the two cannot
                  drift. It is never the refused one: `full` means four pinned
                  rows, and four pinned rows leave no room for a guessed one,
                  so everything in this block is already pinned and unpinning
                  is never refused.
                */}
                <PinButton
                  pinned={row.pinned}
                  label={t(row.item.labelKey)}
                  onPin={() => onToggle(row.href)}
                  className={cn(
                    "size-7",
                    row.pinned
                      ? "text-primary/80 opacity-100"
                      : "opacity-0 group-hover/quick:opacity-100",
                  )}
                />
                {/*
                  Only a guessed row can be dismissed. A pinned row already has
                  its own way out, and offering two different removals for the
                  same thing would mean one of them did something surprising.
                */}
                {!row.pinned && (
                  <button
                    type="button"
                    onClick={() => onDismiss(row.href)}
                    aria-label={t("nav.removeShortcut", {
                      name: t(row.item.labelKey),
                    })}
                    title={t("nav.removeShortcut", { name: t(row.item.labelKey) })}
                    className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent focus-visible:ring-ring grid size-7 place-items-center rounded-md opacity-0 transition group-hover/quick:opacity-100 focus-visible:ring-2 focus-visible:opacity-100 focus-visible:outline-none"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={cn("bg-border/70 mt-2 h-px", rail ? "mx-auto w-6" : "mx-2")} />
    </div>
  );
}

/* ================================================================== *
 * A group
 * ================================================================== */

function Group({
  section,
  open,
  onToggleOpen,
  pathname,
  rail,
  plan,
  first,
  hints,
  isPinned,
  pinFull,
  onPin,
  onFlyout,
}: {
  section: NavSection;
  open: boolean;
  onToggleOpen: () => void;
  pathname: string;
  rail: boolean;
  plan: string;
  /** Only to decide whether the rail draws a rule above this group. */
  first: boolean;
  hints: Record<string, string[]>;
  isPinned: (href: string) => boolean;
  /** Quick access is already holding its four. */
  pinFull: boolean;
  onPin: (href: string) => void;
  onFlyout: (f: Flyout | null) => void;
}) {
  const t = useT();
  const title = t(section.titleKey);
  const panelId = `nav-${section.titleKey.replace(/\W+/g, "-")}`;

  /*
   * In the rail a group is a hairline and nothing else. There is nowhere to
   * put a heading and nothing sensible to click — and a collapsed group inside
   * a collapsed sidebar would be a menu item hidden behind two separate
   * things, neither of which is visible.
   */
  if (rail) {
    return (
      <div>
        {/*
          A rule ABOVE each group but the first, rather than below each one.
          Below meant the divider was always the last child of its own wrapper,
          so `last:hidden` matched every time and the rail had no separators at
          all — twenty-seven icons in one undifferentiated column.
        */}
        {!first && <div className="bg-border/70 mx-auto my-2 h-px w-6" />}
        <div className="space-y-0.5">
          {section.items.map((item) => (
            <NavRow
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              rail
              pinned={isPinned(item.href)}
              plan={plan}
              hint={hints[item.href]}
              onFlyout={onFlyout}
            />
          ))}
        </div>
      </div>
    );
  }

  /*
   * The lead section: its rows, and no heading to collapse them behind. See
   * `lead` on NavSection — this one must be visible however somebody has
   * arranged the rest of the menu.
   */
  if (section.lead) {
    return (
      <div className="space-y-0.5">
        {section.items.map((item) => (
          <NavRow
            key={item.href}
            item={item}
            active={isActive(pathname, item.href)}
            rail={false}
            pinned={isPinned(item.href)}
            pinFull={pinFull}
            plan={plan}
            hint={hints[item.href]}
            onPin={() => onPin(item.href)}
            onFlyout={onFlyout}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        aria-controls={panelId}
        className="text-sidebar-foreground/45 hover:text-sidebar-foreground focus-visible:ring-ring flex w-full items-center justify-between rounded-lg px-2 py-1 text-[10px] font-bold tracking-wider uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        {title}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3.5 transition-transform duration-200 motion-reduce:transition-none",
            !open && "-rotate-90",
          )}
        />
      </button>

      {/*
        Animated by grid rows rather than max-height, so the open state is the
        content's real height and a group with six items does not have to be
        told what six items measure.
      */}
      <div
        id={panelId}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-0.5 pt-0.5 pb-1">
            {section.items.map((item) => (
              <NavRow
                key={item.href}
                item={item}
                active={isActive(pathname, item.href)}
                rail={false}
                pinned={isPinned(item.href)}
                pinFull={pinFull}
                plan={plan}
                hint={hints[item.href]}
                onPin={() => onPin(item.href)}
                onFlyout={onFlyout}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== *
 * How the sections open
 * ================================================================== */

/**
 * Expand all, collapse all, or follow the page.
 *
 * Three ways of answering one question — how much of a twenty-seven entry menu
 * do you want to see at once — and no reason to guess which. The person who
 * wants the whole map in front of them and the person who wants one thing at a
 * time are both right about their own work.
 *
 * Expand all and Collapse all both switch the mode back to `manual`, rather
 * than being disabled while `focus` is on. A control that is visible and does
 * nothing is worse than one that quietly means "and stop following the page",
 * which is what somebody pressing Expand all has just asked for.
 */
function SectionsMenu({
  mode,
  onExpandAll,
  onCollapseAll,
  onToggleFocus,
}: {
  mode: GroupMode;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onToggleFocus: () => void;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("nav.sectionOptions")}
        title={t("nav.sectionOptions")}
        className="text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent focus-visible:ring-ring grid size-8 place-items-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <SlidersHorizontal className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          {t("nav.sectionOptions")}
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={onExpandAll}>
          <ChevronsUpDown />
          {t("nav.expandAll")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCollapseAll}>
          <ChevronsDownUp />
          {t("nav.collapseAll")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/*
          A tick rather than a switch, and the same shape the church switcher
          in the account menu uses: this list is a list of choices, and one of
          them happens to be on.
        */}
        <DropdownMenuItem onClick={onToggleFocus}>
          {mode === "focus" ? <Check /> : <Crosshair />}
          <span className="flex-1">{t("nav.focusSections")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ================================================================== *
 * The sidebar
 * ================================================================== */

export function Sidebar({
  churchName,
  userName,
  userEmail,
  userImage,
  isSuperAdmin = false,
  perms = [],
  churchSlug = null,
  isOwner = false,
  plan = "starter",
  churches = [],
  activeChurchId = null,
  defaultRail = false,
}: {
  churchName: string;
  userName: string;
  userEmail: string;
  userImage?: string | null;
  isSuperAdmin?: boolean;
  perms?: string[];
  /** For hiding a module that is only being piloted elsewhere. */
  churchSlug?: string | null;
  isOwner?: boolean;
  /**
   * The church's plan, so the menu can say which tier a module needs. Defaults
   * to the smallest, like every other allowance in the app.
   */
  plan?: string;
  /** For the switcher in the account menu. Empty or one = no switcher. */
  churches?: { id: string; name: string }[];
  activeChurchId?: string | null;
  /**
   * Collapsed or not, read from a cookie by the layout.
   *
   * A prop rather than a storage read, so the very first paint is already the
   * right width. See `lib/nav-rail.ts` for why this one preference is a cookie
   * when every other one is not.
   */
  defaultRail?: boolean;
}) {
  const t = useT();
  const pathname = usePathname();

  const sections = useMemo(
    () => visibleNavSections(perms, isOwner, churchSlug),
    [perms, isOwner, churchSlug],
  );
  const scrolling = sections.filter((s) => !s.footer);
  /* Help, alone: Notifications and Settings are in the account menu below. */
  const footerItems = useMemo(() => sidebarFooterItems(sections), [sections]);

  /* The chords, written for this machine once rather than per row. */
  const isMac = useIsMac();
  const hints = useMemo(() => navKeyHints(isMac), [isMac]);

  /* --- collapsed or not -------------------------------------------- */

  const [rail, setRail] = useState(defaultRail);
  const setRailAndRemember = useCallback((next: boolean) => {
    setRail(next);
    document.cookie = railCookieString(next);
  }, []);

  /*
   * ⌘\ toggles it from anywhere. The key itself is in the one shortcut
   * registry; the provider cannot reach into this component's state, so it
   * fires an event and this listens — the same arrangement the ⌘K palette
   * uses.
   *
   * The listener is attached once and reads the current width through a ref,
   * rather than re-subscribing every time the width changes. Assigned in an
   * effect, not during render: a ref mutated while rendering is a lint error
   * in this project, and a render React discards would still have changed it.
   */
  const railRef = useRef(rail);
  useEffect(() => {
    railRef.current = rail;
  });
  useEffect(() => {
    const onToggle = () => setRailAndRemember(!railRef.current);
    window.addEventListener(TOGGLE_SIDEBAR_EVENT, onToggle);
    return () => window.removeEventListener(TOGGLE_SIDEBAR_EVENT, onToggle);
  }, [setRailAndRemember]);

  /* --- which groups are open --------------------------------------- */

  /*
   * The groups that actually collapse — so, not the lead section.
   *
   * Leaving Home in here was wrong in a way worth recording: "only the section
   * I'm in" would then match Home while you were on the dashboard, which is
   * where every sign-in lands, and the menu would greet a new church with
   * seven shut headings. Out of this list, the dashboard has no group, and the
   * fallback in `resolveOpenGroups` opens the first real one instead.
   */
  const navGroups: NavGroup[] = useMemo(
    () =>
      scrolling
        .filter((s) => !s.lead)
        .map((s) => ({
          title: s.titleKey,
          hrefs: s.items.map((i) => i.href),
        })),
    [scrolling],
  );
  const groupCount = navGroups.length;
  const closedRaw = useStoredValue(CLOSED_GROUPS_KEY);
  const closed = useMemo(() => parseStored<string[]>(closedRaw, []), [closedRaw]);
  const mode = parseGroupMode(useStoredValue(GROUP_MODE_KEY));
  const active = activeHref(
    pathname,
    sections.flatMap((s) => s.items.map((i) => i.href)),
  );

  /*
   * The group somebody has opened by hand while the menu is following the
   * page.
   *
   * Memory, not storage, and it lasts until the next page — which is what
   * makes it a glance rather than a second setting arguing with the first.
   * Open Media & sharing to find one thing, click it, and the menu is
   * following the page again with nothing left over to explain.
   *
   * It is a LIFETIME and not a lookup, and the difference is the whole bug it
   * was written as first. Holding the page it was taken on and comparing —
   * `glance.on === active` — reads like an expiry and is not one: it suspends
   * the glance while you are elsewhere and brings it back the moment you
   * return, so coming back to a page an hour later would fold the group that
   * page is in and open one nobody had asked for since. Two pages outside the
   * menu share that key as well, because `active` is `undefined` for all of
   * them. So the glance is dropped when the path changes, by comparing against
   * the path of the render that set it.
   *
   * Adjusted during render rather than in an effect: React documents this for
   * exactly this case, it is one extra render React discards rather than a
   * committed paint of the wrong menu, and a setState in an effect body is a
   * lint error in this project for the cascade it causes.
   */
  const [peek, setPeek] = useState<string | null>(null);
  const [peekPath, setPeekPath] = useState(pathname);
  if (peekPath !== pathname) {
    setPeekPath(pathname);
    if (peek !== null) setPeek(null);
  }

  const open = resolveOpenGroups(navGroups, closed, active, mode, peek);

  const setMode = (next: GroupMode) => writeStoredValue(GROUP_MODE_KEY, next);
  const setClosed = (next: string[]) =>
    writeStoredValue(CLOSED_GROUPS_KEY, JSON.stringify(next));

  /*
   * A heading press, in both modes.
   *
   * In `manual` it is what it looks like: that group's own open/closed state,
   * remembered. In `focus` it moves the one open group — press Media & sharing
   * and Media & sharing opens while everything else folds, which is the same
   * promise the mode already makes about navigating, kept for the mouse too.
   * It does NOT leave the mode. It used to, and that was wrong in a way worth
   * recording: a single glance into another group silently turned the setting
   * off, so the behaviour somebody chose was spent by using the menu, and
   * putting it back meant finding the sliders again.
   *
   * Pressing the group that is already open clears the choice instead of
   * shutting it, so the menu goes back to following the page. In `focus` mode
   * "nothing open" is not one of the available answers — an all-shut sidebar
   * is the state that looks broken — and the group holding the page you are
   * reading has to stay visible either way.
   */
  const toggleGroup = (titleKey: string) => {
    if (mode === "focus") {
      setPeek(open.has(titleKey) ? null : titleKey);
      return;
    }
    setClosed(toggleClosed(closed, titleKey));
  };

  /* --- quick access ------------------------------------------------- */

  const quick = useQuickAccess({ perms, isOwner, churchSlug });

  /* --- the rail's floating label ------------------------------------ */

  const [flyout, setFlyout] = useState<Flyout | null>(null);
  // A label pinned to a rectangle has to go when the rectangle moves.
  useEffect(() => {
    if (!flyout) return;
    const clear = () => setFlyout(null);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    return () => {
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
    };
  }, [flyout]);

  return (
    <aside
      data-rail={rail ? "" : undefined}
      className={cn(
        "bg-sidebar text-sidebar-foreground hidden shrink-0 self-start border-r transition-[width] duration-200 ease-out motion-reduce:transition-none lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col",
        rail ? "w-[4.25rem]" : "w-72",
      )}
    >
      {/* ---- the mark, and the collapse control ---- */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center",
          rail ? "justify-center" : "justify-between px-4",
        )}
      >
        {rail ? (
          <Link href="/dashboard" aria-label="FlockInsight">
            <Logo className="size-9" />
          </Link>
        ) : (
          <>
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <Logo className="size-9" />
              <span className="text-xl font-extrabold tracking-tight">
                Flock<span className="text-primary">Insight</span>
              </span>
            </Link>
            {/* ----
              The two controls that act on the menu itself, together, where
              anybody looks for menu chrome.

              This is the third place the sections control went and the reason
              is worth keeping. It started below the last group, which put it
              twenty-seven rows down and off the screen entirely — not quiet,
              absent. It then had a labelled row of its own above the list,
              where the word SECTIONS sat directly over the words QUICK ACCESS
              and read as a heading for them. Beside the collapse button it is
              unambiguous, costs no vertical space, and sits next to the other
              control that changes the shape of the menu.
            ---- */}
            <div className="flex shrink-0 items-center gap-0.5">
              {groupCount > 1 && (
                <SectionsMenu
                  mode={mode}
                  onExpandAll={() => {
                    setMode("manual");
                    setClosed([]);
                    setPeek(null);
                  }}
                  onCollapseAll={() => {
                    setMode("manual");
                    setClosed(allClosed(navGroups));
                    setPeek(null);
                  }}
                  /* Choosing the mode starts it from the page you are on,
                     never from a glance taken before it was switched on. */
                  onToggleFocus={() => {
                    setMode(mode === "focus" ? "manual" : "focus");
                    setPeek(null);
                  }}
                />
              )}
              <CollapseButton rail={rail} onClick={() => setRailAndRemember(true)} />
            </div>
          </>
        )}
      </div>

      {/* ---- whose church this is ---- */}
      {rail ? (
        <div className="flex justify-center pb-1">
          <span
            title={churchName}
            className="bg-sidebar-accent/60 grid size-9 place-items-center rounded-xl"
          >
            <Church aria-hidden className="text-primary size-4" />
            <span className="sr-only">{churchName}</span>
          </span>
        </div>
      ) : (
        <div className="px-3">
          <div className="bg-sidebar-accent/60 flex items-center gap-2.5 rounded-xl px-3 py-2.5">
            <Church aria-hidden className="text-primary size-4 shrink-0" />
            <span className="truncate text-sm font-semibold">{churchName}</span>
          </div>
        </div>
      )}

      {/* ---- the menu ---- */}
      <nav
        aria-label={t("nav.menu")}
        className={cn(
          // `sidebar-scroll-shadow` is the cue that there is more below. Twenty-seven
          // entries never fit a laptop, and an edge that is simply cut off
          // reads as the end of the list.
          "sidebar-scroll-shadow min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3 pb-2",
          rail ? "px-2" : "px-3",
        )}
      >
        <QuickAccessBlock
          rows={quick.rows}
          pathname={pathname}
          rail={rail}
          plan={plan}
          hints={hints}
          onToggle={quick.toggle}
          onDismiss={quick.dismiss}
          onFlyout={setFlyout}
        />

        <div className={rail ? "space-y-0" : "space-y-1.5"}>
          {scrolling.map((section, i) => (
            <Group
              key={section.titleKey}
              section={section}
              first={i === 0}
              open={open.has(section.titleKey)}
              onToggleOpen={() => toggleGroup(section.titleKey)}
              pathname={pathname}
              rail={rail}
              plan={plan}
              hints={hints}
              isPinned={quick.isPinned}
              pinFull={quick.full}
              onPin={quick.toggle}
              onFlyout={setFlyout}
            />
          ))}
        </div>

      </nav>

      {/* ----
        Help, below the scroll rather than in it — and on its own.

        It is what somebody reaches for when they are already stuck, and making
        them scroll past twenty-four modules to find the word "Help" is the
        moment a church gives up and sends a WhatsApp message instead.

        Notifications and Settings used to sit here with it. They have gone to
        the account menu directly below, which is where somebody looks for
        their own account anyway, and the bell in the top bar already carries
        the unread count. `sidebarFooterItems` is what decides; the phone's
        sheet still lists all three.
      ---- */}
      {footerItems.length > 0 && (
        <div
          className={cn(
            "shrink-0 space-y-0.5 border-t pt-2 pb-1",
            rail ? "px-2" : "px-3",
          )}
        >
          {footerItems.map((item) => (
            <NavRow
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              rail={rail}
              pinned={quick.isPinned(item.href)}
              pinFull={quick.full}
              plan={plan}
              hint={hints[item.href]}
              onPin={() => quick.toggle(item.href)}
              onFlyout={setFlyout}
            />
          ))}
        </div>
      )}

      {/* ---- who you are, and the way back out ---- */}
      <div className={cn("shrink-0 border-t", rail ? "space-y-1 p-2" : "p-3")}>
        {rail && (
          <CollapseButton
            rail
            onClick={() => setRailAndRemember(false)}
            className="w-full"
          />
        )}
        <UserMenu
          name={userName}
          email={userEmail}
          image={userImage}
          isSuperAdmin={isSuperAdmin}
          churches={churches}
          activeChurchId={activeChurchId}
          className="w-full"
        />
      </div>

      <RailFlyout flyout={rail ? flyout : null} />
    </aside>
  );
}

/** The one control, labelled for whichever direction it is about to go. */
function CollapseButton({
  rail,
  onClick,
  className,
}: {
  rail: boolean;
  onClick: () => void;
  className?: string;
}) {
  const t = useT();
  const isMac = useIsMac();
  const label = rail ? t("nav.expandMenu") : t("nav.collapseMenu");
  /*
   * The chord is built from the registry rather than written into the
   * dictionary, because it differs by platform: telling a Mac user to press
   * Ctrl is telling them to press the wrong key, and a translator cannot know
   * which machine is reading.
   */
  const chord = keyLabel("mod+b", isMac);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={rail}
      title={`${label} (${chord})`}
      className={cn(
        "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent focus-visible:ring-ring grid size-8 place-items-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
    >
      {rail ? (
        <PanelLeftOpen className="size-4" />
      ) : (
        <PanelLeftClose className="size-4" />
      )}
    </button>
  );
}
