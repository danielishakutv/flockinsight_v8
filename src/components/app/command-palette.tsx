"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Keyboard, Search, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { mobileMenuSections, navVisible } from "@/lib/nav";
import { SETTINGS_GROUPS, type Need } from "@/components/app/settings-nav";
import { keysLabel, type Shortcut } from "@/lib/shortcuts";
import { rankRows } from "@/lib/palette-rank";
import { useT } from "@/components/i18n-provider";
import { useIsMac } from "@/lib/use-is-mac";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LucideIcon } from "lucide-react";

/**
 * ⌘K — one box that reaches the whole app.
 *
 * The destinations are read from `mobileMenuSections`, the same list the
 * sidebar renders, so a new module becomes searchable the moment it appears in
 * the menu and nobody has to remember this file exists. That is not a
 * convenience; it is the lesson from the three modules that shipped invisible
 * because they were added to a second list that nothing read.
 *
 * Three kinds of row:
 *
 *  - **Do** — the handful of things you can start from anywhere, listed first
 *    while the box is empty, because "add a member" is what somebody reaching
 *    for a command palette on a Sunday morning actually wants.
 *  - **Go** — every module in the menu.
 *  - **Settings** — the twenty-one setting pages, which are otherwise four
 *    clicks deep and the single most common thing support gets asked to find.
 */

export type PaletteRow = {
  id: string;
  label: string;
  sub: string;
  href: string;
  icon: LucideIcon;
  kind: "do" | "go" | "settings";
  /** The keys, when this row has some, shown on the right of the row. */
  keys?: readonly string[];
  haystack: string;
};

const MAX_RESULTS = 14;

export function CommandPalette({
  open,
  onOpenChange,
  perms = [],
  isOwner = false,
  churchSlug = null,
  available,
  onPerform,
  onOpenSheet,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  perms?: string[];
  isOwner?: boolean;
  churchSlug?: string | null;
  /** Unused today; kept so the row can show a plan chip later. */
  plan?: string;
  /** Already permission-filtered by the provider. */
  available: readonly Shortcut[];
  onPerform: (s: Shortcut) => void;
  onOpenSheet: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const isMac = useIsMac();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo<PaletteRow[]>(() => {
    const out: PaletteRow[] = [];

    /* --- Things to do, from the registry ------------------------- */
    for (const s of available) {
      if (s.group !== "do" || !s.href) continue;
      const label = t(s.labelKey);
      out.push({
        id: s.id,
        label,
        sub: t("shortcuts.paletteHintDo"),
        href: s.href,
        icon: Zap,
        kind: "do",
        keys: s.keys,
        haystack: `${label} ${(s.keywords ?? []).join(" ")}`.toLowerCase(),
      });
    }

    /* --- Everywhere the sidebar can go --------------------------- */
    const keysByHref = new Map(
      available
        .filter((s) => s.group === "go" && s.href)
        .map((s) => [s.href!, s.keys] as const),
    );

    for (const section of mobileMenuSections) {
      for (const item of section.items) {
        if (!navVisible(item, perms, isOwner, churchSlug)) continue;
        const label = t(item.labelKey);
        const sub = t(item.descriptionKey);
        out.push({
          id: `go:${item.href}`,
          label,
          sub,
          href: item.href,
          icon: item.icon,
          kind: "go",
          keys: keysByHref.get(item.href),
          haystack: `${label} ${sub}`.toLowerCase(),
        });
      }
    }

    /* --- Settings pages ------------------------------------------ *
     *
     * Gated with the same four questions `settings/layout.tsx` asks, so the
     * palette cannot offer a page that would redirect on arrival.
     */
    const allow = (need: Need) => {
      if (isOwner) return true;
      switch (need) {
        case "settings":
          return perms.includes("settings.manage");
        case "team":
          return perms.includes("team.manage");
        case "finance":
          return perms.includes("finance.view");
        case "giving":
          return perms.includes("giving.view");
      }
    };

    for (const group of SETTINGS_GROUPS) {
      for (const item of group.items) {
        if (!allow(item.need)) continue;
        const label = t(item.labelKey);
        const sub = t(group.titleKey);
        out.push({
          id: `set:${item.href}`,
          label,
          sub: `${t("nav.settings")} · ${sub}`,
          href: item.href,
          icon: item.icon,
          kind: "settings",
          haystack: `${label} ${sub} settings`.toLowerCase(),
        });
      }
    }

    return out;
  }, [available, perms, isOwner, churchSlug, t]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Nothing typed: the things you can DO first, then the modules. Not the
    // settings pages — twenty-one of those would bury the six that matter.
    if (!q) {
      return [
        ...rows.filter((r) => r.kind === "do"),
        ...rows.filter((r) => r.kind === "go"),
      ].slice(0, MAX_RESULTS);
    }

    /*
     * Ranked, not merely filtered. Typing "mem" should put Members at the top
     * rather than wherever it happens to fall — a palette whose first row is
     * usually wrong is one people stop trusting after about three tries.
     * `rankRows` is pure and has its own tests.
     */
    return rankRows(rows, q, MAX_RESULTS);
  }, [rows, query]);

  // Derived rather than reset in an effect: clamping keeps the highlight valid
  // when the list shrinks, with no extra render pass.
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  function go(row: PaletteRow) {
    onOpenChange(false);
    setQuery("");
    setActive(0);
    /*
     * A "do" row goes through the provider, not straight to the router, so
     * that choosing "Add a member" with the mouse counts as having learned
     * `n m` exactly as pressing the keys would. Teaching somebody a shortcut
     * they have been using from the palette all along would be absurd.
     */
    if (row.kind === "do") {
      const s = available.find((x) => x.id === row.id);
      if (s) {
        onPerform(s);
        return;
      }
    }
    router.push(row.href);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setQuery("");
          setActive(0);
        }
      }}
    >
      <DialogContent
        className="top-[12%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">{t("shortcuts.palette")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("shortcuts.palettePlaceholder")}
        </DialogDescription>

        <div className="flex items-center gap-2 border-b px-4">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive(Math.min(results.length - 1, activeIndex + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive(Math.max(0, activeIndex - 1));
              } else if (e.key === "Enter" && results[activeIndex]) {
                e.preventDefault();
                go(results[activeIndex]);
              }
            }}
            placeholder={t("shortcuts.palettePlaceholder")}
            aria-label={t("shortcuts.palettePlaceholder")}
            className="w-full bg-transparent py-3.5 text-sm outline-none"
          />
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {t("shortcuts.paletteEmpty")}
            </p>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition",
                  i === activeIndex ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-lg",
                    r.kind === "do"
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <r.icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {r.label}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {r.sub}
                  </span>
                </span>
                {r.keys && (
                  <span className="text-muted-foreground hidden shrink-0 gap-1 font-mono text-[10px] sm:flex">
                    {r.keys.map((k, n) => (
                      <kbd
                        key={n}
                        className="bg-muted rounded border px-1.5 py-0.5"
                      >
                        {keysLabel([k], isMac)}
                      </kbd>
                    ))}
                  </span>
                )}
                {i === activeIndex && (
                  <CornerDownLeft className="text-muted-foreground size-3.5 shrink-0" />
                )}
              </button>
            ))
          )}
        </div>

        {/* The footer is the only place most people will ever learn that the
            cheat sheet exists, so it is a button and not a line of text. */}
        <div className="text-muted-foreground flex items-center justify-between gap-2 border-t px-3 py-2 text-[11px]">
          <span className="hidden items-center gap-1.5 sm:flex">
            <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono">↑↓</kbd>
            {t("shortcuts.paletteNavigate")}
            <kbd className="bg-muted ml-1.5 rounded border px-1.5 py-0.5 font-mono">↵</kbd>
            {t("shortcuts.paletteFooter")}
          </span>
          <button
            type="button"
            onClick={onOpenSheet}
            className="hover:text-foreground ml-auto inline-flex items-center gap-1.5 font-semibold"
          >
            <Keyboard className="size-3.5" />
            {t("shortcuts.openSheet")}
            <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono">?</kbd>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
