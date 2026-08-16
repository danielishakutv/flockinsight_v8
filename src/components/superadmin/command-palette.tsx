"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CornerDownLeft,
  Loader2,
  Search,
  User as UserIcon,
} from "lucide-react";
import {
  loadPaletteEntries,
  type PaletteEntry,
} from "@/app/superadmin/search-actions";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

const NAV_ENTRIES: PaletteEntry[] = [
  { id: "nav-overview", label: "Overview", sub: "Command centre", href: "/superadmin", kind: "church" },
  { id: "nav-health", label: "Platform health", sub: "Float, crons, integrations", href: "/superadmin/health", kind: "church" },
  { id: "nav-churches", label: "Churches", sub: "All churches", href: "/superadmin/churches", kind: "church" },
  { id: "nav-users", label: "Users", sub: "All users", href: "/superadmin/users", kind: "church" },
  { id: "nav-growth", label: "Growth", sub: "Leads and the sales pipeline", href: "/superadmin/growth", kind: "church" },
  { id: "nav-outreach", label: "Outreach", sub: "Email and SMS campaigns", href: "/superadmin/growth/outreach", kind: "church" },
  { id: "nav-sms", label: "SMS", sub: "Sender IDs and wallets", href: "/superadmin/sms", kind: "church" },
  { id: "nav-support", label: "Support", sub: "Tickets", href: "/superadmin/support", kind: "church" },
  { id: "nav-pricing", label: "Pricing", sub: "Plans and prices", href: "/superadmin/pricing", kind: "church" },
  { id: "nav-backups", label: "Backups", sub: "Database backups", href: "/superadmin/backups", kind: "church" },
];

const MAX_RESULTS = 12;

/** Jump to any church, user or page. Opens with Cmd/Ctrl+K. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<PaletteEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load the index the first time the palette is actually opened. Kicked off
  // from the open handlers rather than an effect, so no setState runs
  // synchronously during an effect body.
  const loadedRef = useRef(false);
  const ensureLoaded = useCallback(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    loadPaletteEntries()
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  const openPalette = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) ensureLoaded();
    },
    [ensureLoaded],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Reading the current value inside the updater keeps this a single
        // event-driven update.
        setOpen((v) => {
          if (!v) ensureLoaded();
          return !v;
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ensureLoaded]);

  const results = useMemo(() => {
    const all = [...NAV_ENTRIES, ...(entries ?? [])];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, MAX_RESULTS);
    return all
      .filter((e) => `${e.label} ${e.sub}`.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS);
  }, [entries, query]);

  // Derived rather than reset in an effect: clamping keeps the highlight valid
  // when the result list shrinks, with no extra render pass.
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  function go(entry: PaletteEntry) {
    setOpen(false);
    setQuery("");
    router.push(entry.href);
  }

  return (
    <Dialog open={open} onOpenChange={openPalette}>
      <DialogContent
        className="top-[15%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Jump to any church, user or admin page.
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
            placeholder="Search churches, users and pages"
            className="w-full bg-transparent py-3.5 text-sm outline-none"
          />
          {loading && (
            <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
          )}
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {loading ? "Loading…" : "Nothing matches that."}
            </p>
          ) : (
            results.map((e, i) => (
              <button
                key={e.id}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(e)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition",
                  i === activeIndex ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <span className="bg-muted grid size-8 shrink-0 place-items-center rounded-lg">
                  {e.kind === "user" ? (
                    <UserIcon className="size-4" />
                  ) : (
                    <Building2 className="size-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {e.label}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {e.sub}
                  </span>
                </span>
                {i === activeIndex && (
                  <CornerDownLeft className="text-muted-foreground size-3.5 shrink-0" />
                )}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The affordance — without it nobody discovers the shortcut. */
export function CommandPaletteHint() {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
        )
      }
      className="text-muted-foreground hover:bg-accent hidden items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold sm:inline-flex"
    >
      <Search className="size-3.5" />
      Search
      <kbd className="bg-muted rounded px-1.5 py-0.5 font-mono text-[10px]">
        ⌘K
      </kbd>
    </button>
  );
}
