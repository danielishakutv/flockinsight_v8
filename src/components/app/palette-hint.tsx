"use client";

import { Search } from "lucide-react";
import { openCommandPalette } from "@/components/app/shortcuts-provider";
import { useT } from "@/components/i18n-provider";
import { useIsMac } from "@/lib/use-is-mac";

/**
 * The search box in the top bar that is really the ⌘K palette.
 *
 * Without this, the shortcuts are a secret. Nobody presses ⌘K in an app they
 * have never pressed ⌘K in, so the discoverable thing has to be the thing on
 * screen — and it is drawn as a search field rather than a button because that
 * is what people reach for when they are looking for something, and the keys
 * printed on the right are how they learn there is a faster way.
 *
 * Desktop only. On a phone the sidebar is a tap away and there is no keyboard
 * to teach.
 */
export function PaletteHint() {
  const t = useT();
  const isMac = useIsMac();

  return (
    <button
      type="button"
      onClick={openCommandPalette}
      className="text-muted-foreground hover:bg-accent hover:text-foreground hidden h-9 w-64 items-center gap-2 rounded-xl border px-3 text-left text-sm transition lg:flex"
    >
      <Search className="size-4 shrink-0" />
      <span className="flex-1 truncate">{t("shortcuts.palette")}</span>
      <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold">
        {isMac ? "⌘K" : "Ctrl K"}
      </kbd>
    </button>
  );
}
