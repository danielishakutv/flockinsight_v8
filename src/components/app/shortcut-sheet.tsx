"use client";

import Link from "next/link";
import { Keyboard } from "lucide-react";
import {
  SHORTCUT_GROUPS,
  keyLabel,
  type Shortcut,
  type ShortcutGroup,
} from "@/lib/shortcuts";
import { MNEMONICS } from "@/lib/shortcut-mnemonics";
import { useT } from "@/components/i18n-provider";
import { useIsMac } from "@/lib/use-is-mac";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The `?` cheat sheet.
 *
 * Shows only what this person can actually use — the provider has already run
 * the list through `navVisible` — because a sheet listing keys that do nothing
 * teaches somebody that none of them work.
 *
 * Where the letter is not the first letter of the word, the sheet says where
 * it came from. "g b — Facilities (b for bookings)" is the difference between
 * a mnemonic and a thing to memorise.
 */
export function ShortcutSheet({
  open,
  onOpenChange,
  available,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  available: readonly Shortcut[];
}) {
  const t = useT();
  const isMac = useIsMac();

  const groups = SHORTCUT_GROUPS.map((g) => ({
    ...g,
    items: available.filter((s) => s.group === (g.key as ShortcutGroup)),
  })).filter((g) => g.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="bg-primary/15 text-primary grid size-8 shrink-0 place-items-center rounded-lg">
              <Keyboard className="size-4" />
            </span>
            {t("shortcuts.title")}
          </DialogTitle>
          <DialogDescription>{t("shortcuts.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 sm:grid-cols-2">
          {groups.map((group) => (
            <div key={group.key}>
              <p className="text-muted-foreground mb-2 text-[10px] font-bold tracking-wider uppercase">
                {t(group.titleKey)}
              </p>
              <ul className="space-y-1">
                {group.items.map((s) => {
                  const mnemonic = MNEMONICS[s.id];
                  return (
                    <li
                      key={s.id}
                      className="flex items-baseline justify-between gap-3 rounded-lg px-1 py-1.5"
                    >
                      <span className="min-w-0 text-sm">
                        <span className="font-medium">{t(s.labelKey)}</span>
                        {mnemonic && (
                          <span className="text-muted-foreground block text-[11px]">
                            {t(mnemonic)}
                          </span>
                        )}
                      </span>
                      <Keys keys={s.keys} isMac={isMac} then={t("shortcuts.then")} />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <p className="text-muted-foreground border-t pt-3 text-xs">
          <Link
            href="/help/keyboard-shortcuts"
            onClick={() => onOpenChange(false)}
            className="text-primary font-semibold underline"
          >
            {t("shortcuts.tipSeeAll")}
          </Link>
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** The keys as keys, with the word for "then" between them. */
export function Keys({
  keys,
  isMac,
  then,
  className = "",
}: {
  keys: readonly string[];
  isMac: boolean;
  then: string;
  className?: string;
}) {
  return (
    <span
      className={`flex shrink-0 items-center gap-1 whitespace-nowrap ${className}`}
    >
      {keys.map((k, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && (
            <span className="text-muted-foreground text-[10px]">{then}</span>
          )}
          <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold">
            {keyLabel(k, isMac)}
          </kbd>
        </span>
      ))}
    </span>
  );
}
