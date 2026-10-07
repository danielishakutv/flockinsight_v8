"use client";

import Link from "next/link";
import { Keyboard } from "lucide-react";
import { toast } from "sonner";
import {
  EMPTY_TIP_STATE,
  MAX_TIPS,
  turnTipsOff,
  turnTipsOn,
} from "@/lib/shortcut-tips";
import { SHORTCUTS } from "@/lib/shortcuts";
import { useHasKeyboard, useTipState } from "@/lib/use-shortcut-tips";
import { useT } from "@/components/i18n-provider";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The way back.
 *
 * "No more tips" on the card has to be honoured permanently, which means there
 * has to be somewhere to undo it — otherwise one stray click costs somebody
 * the feature for ever, and the honest thing would have been not to offer the
 * button at all.
 *
 * It also shows the count, which turns out to be the most interesting thing on
 * the card: "you have used 4 of 23 shortcuts" tells somebody there are
 * nineteen more, which no amount of copy does.
 *
 * All of it is per-browser, held in localStorage — so this panel describes
 * this computer, not the account. That is the right scope for a fact about a
 * keyboard, and it is why the panel says so when there is no keyboard here.
 */
export function ShortcutTipsSettings() {
  const t = useT();
  const { state, update } = useTipState();
  const hasKeyboard = useHasKeyboard();

  const learned = state.learned.filter((id) =>
    SHORTCUTS.some((s) => s.id === id),
  ).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="bg-primary/15 text-primary grid size-8 shrink-0 place-items-center rounded-lg">
            <Keyboard className="size-4" />
          </span>
          {t("shortcuts.settingsTitle")}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          {t("shortcuts.settingsBlurb")}
        </p>

        <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
          <label htmlFor="shortcut-tips" className="text-sm font-medium">
            {t("shortcuts.settingsOn")}
          </label>
          <Switch
            id="shortcut-tips"
            checked={!state.off}
            onCheckedChange={(on) => update(on ? turnTipsOn : turnTipsOff)}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            {t("shortcuts.settingsLearned", {
              count: learned,
              total: SHORTCUTS.length,
            })}
          </p>
          {(state.shown.length > 0 || learned > 0) && (
            <button
              type="button"
              onClick={() => {
                // Keeps `off` as they have it: clearing what has been
                // taught is not the same as asking to be interrupted again.
                update((s) => ({
                  ...EMPTY_TIP_STATE,
                  off: s.off,
                  visits: MAX_TIPS * 2,
                }));
                toast.success(t("shortcuts.settingsResetDone"));
              }}
              className="text-primary font-semibold underline"
            >
              {t("shortcuts.settingsReset")}
            </button>
          )}
        </div>

        {!hasKeyboard && (
          <p className="text-muted-foreground border-t pt-3 text-xs">
            {t("shortcuts.settingsNoKeyboard")}
          </p>
        )}

        <p className="border-t pt-3 text-xs">
          <Link
            href="/help/keyboard-shortcuts"
            className="text-primary font-semibold underline"
          >
            {t("shortcuts.tipSeeAll")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
