"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Pin, Search, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";
import { BetaBadge } from "@/components/beta-badge";
import { PlanChip } from "@/components/app/plan-chip";
import { useQuickAccess } from "@/components/app/nav-visits";
import { rankRows } from "@/lib/palette-rank";
import {
  mobileNavLeft,
  mobileNavRight,
  navAllowed,
  navVisible,
  recordAction,
  visibleNavSections,
  type MenuItem,
  type NavItem,
} from "@/lib/nav";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const t = useT();
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-semibold transition-colors",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <item.icon className={cn("size-6", active && "fill-primary/10")} />
      {t(item.labelKey)}
    </Link>
  );
}

/* ================================================================== *
 * One row of the sheet
 * ================================================================== */

/**
 * A sheet row: the whole width navigates, the pin at the right does not.
 *
 * It replaced a chevron. A chevron on every row of a 27-row menu says only
 * "this is a link", which the row already said; a pin does something, and it
 * is the only way somebody who works from a phone — which, for a good number
 * of these churches, is everybody — can put their own five modules at the top.
 *
 * The pin is a 44px target with a rule down its left edge, so it reads as a
 * separate control rather than part of the row, and a mis-tap costs one tap to
 * undo.
 */
function SheetRow({
  item,
  pathname,
  plan,
  pinned,
  onPin,
  onNavigate,
}: {
  item: MenuItem;
  pathname: string;
  plan: string;
  pinned: boolean;
  onPin: () => void;
  onNavigate: () => void;
}) {
  const t = useT();
  const active = isActive(pathname, item.href);
  const label = t(item.labelKey);
  return (
    <div className={cn("flex items-stretch", active && "bg-primary/5")}>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className="active:bg-accent flex min-w-0 flex-1 items-center gap-3 p-2.5 transition-colors"
      >
        <span
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-xl",
            active ? "bg-primary text-primary-foreground" : item.tile,
          )}
        >
          <item.icon className="size-5" strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "flex items-center gap-1.5 leading-tight font-semibold",
              active && "text-primary",
            )}
          >
            <span className="truncate">{label}</span>
            {item.beta && <BetaBadge />}
            {item.feature && <PlanChip feature={item.feature} plan={plan} />}
          </span>
          <span className="text-muted-foreground block truncate text-xs">
            {t(item.descriptionKey)}
          </span>
        </span>
      </Link>
      <button
        type="button"
        onClick={onPin}
        aria-pressed={pinned}
        aria-label={
          pinned ? t("nav.unpin", { name: label }) : t("nav.pin", { name: label })
        }
        className={cn(
          // No rule down its left edge: a border there turns twenty-seven
          // optional controls into a table column, which is most of what the
          // eye sees when the sheet opens. It should be there when looked for
          // and quiet when not.
          "active:bg-accent grid w-12 shrink-0 place-items-center transition-colors",
          pinned ? "text-primary" : "text-muted-foreground/30",
        )}
      >
        <Pin className={cn("size-4", pinned && "fill-current")} />
      </button>
    </div>
  );
}

/* ================================================================== *
 * The bar, and the sheet behind "More"
 * ================================================================== */

export function MobileNav({
  perms = [],
  churchSlug = null,
  isOwner = false,
  plan = "starter",
}: {
  perms?: string[];
  /** For hiding a module that is only being piloted elsewhere. */
  churchSlug?: string | null;
  isOwner?: boolean;
  /** The church's plan, so the sheet can say which tier a module needs. */
  plan?: string;
}) {
  const t = useT();
  const pathname = usePathname();
  const recordActive = isActive(pathname, recordAction.href);
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const leftItems = mobileNavLeft.filter((i) =>
    navVisible(i, perms, isOwner, churchSlug),
  );
  const rightItems = mobileNavRight.filter((i) =>
    navVisible(i, perms, isOwner, churchSlug),
  );
  const canRecord = navAllowed(recordAction.perm, perms, isOwner);
  const sections = useMemo(
    () => visibleNavSections(perms, isOwner, churchSlug),
    [perms, isOwner, churchSlug],
  );
  const quick = useQuickAccess({ perms, isOwner, churchSlug });

  // The "More" tab is active when on a route that isn't one of the quick tabs.
  const quickHrefs = [...leftItems, ...rightItems, recordAction].map(
    (i) => i.href,
  );
  const moreActive = !quickHrefs.some((href) => isActive(pathname, href));

  /*
   * Typing filters the whole menu flat, ranked by the same function that ranks
   * ⌘K on desktop.
   *
   * Twenty-seven entries is past the point where a filter pays for itself, and
   * it is also the only search this app has on a phone — there is no ⌘K on a
   * phone, and the alternative for somebody who cannot remember whether Links
   * is under Media or Communication is to read all seven groups. Ranked with
   * the palette's own function rather than a fresh substring match, so "giv"
   * puts Giving above Finance on a phone for exactly the reasons it does on a
   * laptop.
   */
  const items = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    return rankRows(
      items.map((item) => ({
        item,
        label: t(item.labelKey),
        haystack: `${t(item.labelKey)} ${t(item.descriptionKey)}`.toLowerCase(),
        kind: "go" as const,
      })),
      q,
      12,
    ).map((r) => r.item);
  }, [query, items, t]);

  /* --- the sheet's own housekeeping -------------------------------- */

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [moreOpen]);

  /*
   * The search box is NOT focused when the sheet opens, on purpose. Focusing
   * it raises the keyboard over the menu somebody opened in order to look at
   * it, and most taps here are "show me the list", not "let me type".
   */
  function closeSheet() {
    setMoreOpen(false);
    setQuery("");
  }

  return (
    <>
      <nav
        aria-label={t("nav.menu")}
        className="bg-background/90 fixed inset-x-0 bottom-0 z-30 flex items-end border-t backdrop-blur lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex flex-1 items-stretch">
          {leftItems.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </div>

        {/* Center Record button */}
        {canRecord && (
          <div className="flex w-20 shrink-0 justify-center">
            <Link
              href={recordAction.href}
              aria-label={t("dashboard.recordAttendance")}
              aria-current={recordActive ? "page" : undefined}
              className="border-background bg-primary text-primary-foreground -mt-6 grid size-16 place-items-center rounded-full border-4 shadow-lg transition-transform active:scale-95 motion-reduce:transition-none"
            >
              <recordAction.icon className="size-7" strokeWidth={2.5} />
            </Link>
          </div>
        )}

        <div className="flex flex-1 items-stretch">
          {rightItems.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label={t("nav.more")}
            aria-expanded={moreOpen}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-semibold transition-colors",
              moreActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <MoreGlyph active={moreActive} />
            {t("nav.more")}
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="lg:hidden">
          {/* Backdrop */}
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={closeSheet}
            className="animate-in fade-in fixed inset-0 z-40 bg-black/50 backdrop-blur-sm duration-200 motion-reduce:animate-none"
          />
          {/* Sheet */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("nav.menu")}
            className="bg-background animate-in slide-in-from-bottom-6 fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-3xl border-t shadow-2xl duration-200 motion-reduce:animate-none"
          >
            <div className="bg-muted mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full" />
            <div className="flex shrink-0 items-center justify-between px-5 pt-3 pb-2">
              <div>
                <p className="text-xl font-extrabold tracking-tight">
                  {t("nav.menu")}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t("nav.menuHint")}
                </p>
              </div>
              <button
                type="button"
                onClick={closeSheet}
                aria-label={t("common.close")}
                className="bg-muted/60 text-muted-foreground hover:text-foreground grid size-11 place-items-center rounded-full"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* ---- filter ---- */}
            <div className="shrink-0 px-4 pb-2">
              <div className="relative">
                <Search
                  aria-hidden
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                />
                <input
                  ref={searchRef}
                  type="search"
                  inputMode="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("nav.filterPlaceholder")}
                  aria-label={t("nav.filterPlaceholder")}
                  className="bg-muted/50 focus-visible:ring-ring h-11 w-full rounded-xl pr-3 pl-9 text-sm focus-visible:ring-2 focus-visible:outline-none"
                />
              </div>
            </div>

            <div
              className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pt-1"
              style={{
                paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)",
              }}
            >
              {results ? (
                results.length === 0 ? (
                  <p className="text-muted-foreground px-2 py-8 text-center text-sm">
                    {t("nav.noMatches", { query: query.trim() })}
                  </p>
                ) : (
                  <div className="bg-card divide-y overflow-hidden rounded-2xl border">
                    {results.map((item) => (
                      <SheetRow
                        key={item.href}
                        item={item}
                        pathname={pathname}
                        plan={plan}
                        pinned={quick.isPinned(item.href)}
                        onPin={() => quick.toggle(item.href)}
                        onNavigate={closeSheet}
                      />
                    ))}
                  </div>
                )
              ) : (
                <>
                  {/* ---- the shortcut row ---- */}
                  {quick.rows.length > 0 && (
                    <div>
                      <p className="text-muted-foreground mb-1.5 flex items-center gap-1.5 px-2 text-[11px] font-bold tracking-wider uppercase">
                        <Sparkles aria-hidden className="size-3" />
                        {t("nav.quickAccess")}
                      </p>
                      {/*
                        Chips rather than rows. On a phone the value of the
                        shortcut row is that the whole of it is visible at once
                        without scrolling, and six full-height rows with
                        descriptions is already most of the screen.
                      */}
                      <div className="flex flex-wrap gap-2">
                        {quick.rows.map((row) => {
                          const active = isActive(pathname, row.href);
                          return (
                            <Link
                              key={row.href}
                              href={row.href}
                              onClick={closeSheet}
                              aria-current={active ? "page" : undefined}
                              className={cn(
                                "flex min-h-11 items-center gap-2 rounded-xl border py-1.5 pr-3 pl-1.5 text-sm font-semibold transition-colors active:scale-[0.98] motion-reduce:transition-none",
                                active
                                  ? "border-primary/40 bg-primary/10 text-primary"
                                  : "bg-card",
                              )}
                            >
                              <span
                                className={cn(
                                  "grid size-8 shrink-0 place-items-center rounded-lg",
                                  row.item.tile,
                                )}
                              >
                                <row.item.icon
                                  className="size-4"
                                  strokeWidth={2.2}
                                />
                              </span>
                              {t(row.item.labelKey)}
                              {/* A filled pin means the same thing here as
                                  everywhere else: you put this here. */}
                              {row.pinned && (
                                <Pin
                                  aria-hidden
                                  className="text-primary/60 size-3 fill-current"
                                />
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {sections.map((section) => (
                    <div key={section.titleKey}>
                      <p className="text-muted-foreground mb-1.5 px-2 text-[11px] font-bold tracking-wider uppercase">
                        {t(section.titleKey)}
                      </p>
                      <div className="bg-card divide-y overflow-hidden rounded-2xl border">
                        {section.items.map((item) => (
                          <SheetRow
                            key={item.href}
                            item={item}
                            pathname={pathname}
                            plan={plan}
                            pinned={quick.isPinned(item.href)}
                            onPin={() => quick.toggle(item.href)}
                            onNavigate={closeSheet}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The "More" glyph: four dots, drawn rather than imported.
 *
 * `LayoutGrid` reads as "dashboard" everywhere else in this app, which is the
 * one thing this tab is not.
 */
function MoreGlyph({ active }: { active: boolean }) {
  return (
    <span aria-hidden className="grid size-6 grid-cols-2 gap-1 p-1">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "rounded-[2px]",
            active ? "bg-primary" : "bg-muted-foreground",
          )}
        />
      ))}
    </span>
  );
}
