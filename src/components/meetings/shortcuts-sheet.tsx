"use client";

import { Keyboard, X } from "lucide-react";
import type { TFunction } from "@/lib/i18n/translate";

/**
 * What the keyboard can do, shown on "?".
 *
 * A shortcut nobody knows about is not a feature. The room had two of these
 * for months — M and V — and nothing anywhere said so, which meant the only
 * people who ever used them were the people who had read the source.
 *
 * Rendered as a plain overlay rather than a Dialog because the room already
 * manages its own focus and Escape handling, and a second component competing
 * for both is how Escape stops closing the thing you expect.
 */
export function ShortcutsSheet({
  open,
  onClose,
  t,
  canRecord,
}: {
  open: boolean;
  onClose: () => void;
  t: TFunction;
  canRecord: boolean;
}) {
  if (!open) return null;

  const rows: { keys: string[]; label: string }[] = [
    { keys: ["M"], label: t("meetings.scMic") },
    { keys: ["V"], label: t("meetings.scCamera") },
    { keys: ["S"], label: t("meetings.scShare") },
    { keys: ["H"], label: t("meetings.scHand") },
    { keys: ["C"], label: t("meetings.scChat") },
    { keys: ["P"], label: t("meetings.scPeople") },
    { keys: ["D"], label: t("meetings.scLowData") },
    { keys: ["Esc"], label: t("meetings.scClose") },
    { keys: ["?"], label: t("meetings.scHelp") },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={t("meetings.shortcuts")}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-5 text-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <Keyboard aria-hidden className="size-4.5" />
            {t("meetings.shortcuts")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="grid size-11 shrink-0 place-items-center rounded-lg text-slate-300 hover:bg-white/10 sm:size-9"
          >
            <X className="size-4" />
          </button>
        </div>

        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <li key={r.keys.join()} className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-300">{r.label}</span>
              <span className="flex shrink-0 gap-1">
                {r.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded border border-white/15 bg-white/10 px-2 py-0.5 font-mono text-[11px] font-bold"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>

        {canRecord && (
          <p className="mt-3 text-xs leading-relaxed text-slate-400">
            {t("meetings.scRecordNote")}
          </p>
        )}

        <p className="mt-3 text-xs leading-relaxed text-slate-400">
          {t("meetings.scTypingNote")}
        </p>
      </div>
    </div>
  );
}
