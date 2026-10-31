"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type CostTab = { key: string; label: string; badge?: number; content: ReactNode };

function subscribe(onChange: () => void) {
  const onHash = () => {
    onChange();
    document.getElementById("cost-tabs")?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  window.addEventListener("hashchange", onHash);
  return () => window.removeEventListener("hashchange", onHash);
}

/**
 * Tabs that follow the URL hash, so a recommendation's "#churches" link opens
 * the right tab and a tab can be bookmarked or shared. Every panel is rendered
 * on the server; this only decides which one shows.
 */
export function CostTabs({ tabs }: { tabs: CostTab[] }) {
  // The hash is the state: an external store, read without an effect.
  const hash = useSyncExternalStore(subscribe, () => window.location.hash.slice(1), () => "");
  const active = tabs.some((t) => t.key === hash) ? hash : tabs[0]?.key;

  function pick(key: string) {
    // A same-page hash navigation: fires hashchange, which the store listens to.
    window.location.assign(`#${key}`);
  }

  return (
    <div id="cost-tabs" className="scroll-mt-20 space-y-4">
      <div role="tablist" aria-label="Cost and profit" className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={active === t.key}
            aria-controls={`cost-panel-${t.key}`}
            onClick={() => pick(t.key)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active === t.key ? "border-primary text-foreground" : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t.label}
            {t.badge ? (
              <span className="rounded-full bg-amber-500/15 px-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">{t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} id={`cost-panel-${t.key}`} role="tabpanel" hidden={active !== t.key}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
