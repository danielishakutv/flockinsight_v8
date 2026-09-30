"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Languages, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/components/i18n-provider";
import { sendTranslationFeedback } from "@/app/(app)/translation-feedback-actions";
import {
  PROMPT_KEY,
  dismiss,
  markAnswered,
  recordActivity,
  shouldAsk,
  type PromptState,
} from "@/lib/translation-prompt";
import { localeInfo } from "@/lib/i18n/locales";
import { useStoredValue, writeStoredValue } from "@/lib/client-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Asking somebody who reads the language whether it reads properly.
 *
 * These translations are machine-assisted. Grammar comes out roughly right and
 * church vocabulary comes out reliably wrong — "offering", "tithe",
 * "first-timer", "cell group" and "service" all carry conventions a
 * congregation would recognise and a translator would not invent. The only
 * people who can fix that are the ones reading it.
 *
 * So it waits. Six pages in that language before it asks anything, a month's
 * silence if they say no, and never again once they have sent something. A
 * prompt on the first screen would collect opinions from people who have seen
 * one heading; a prompt on every screen would collect nothing and a
 * reputation.
 */
export function TranslationPrompt() {
  const locale = useLocale();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [sending, setSending] = useState(false);

  /*
   * The counter lives in localStorage and is READ reactively rather than
   * mirrored into state. It is an external store, so a write here notifies
   * every reader and this component re-renders on its own — no setState in an
   * effect, and the count survives a reload, which is the point of counting.
   */
  const raw = useStoredValue(PROMPT_KEY);
  const state = useMemo<PromptState | null>(() => {
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as PromptState;
    } catch {
      return null;
    }
  }, [raw]);

  // One page view, counted once. Writing to the store IS the side effect.
  useEffect(() => {
    let current: PromptState | null = null;
    try {
      const stored = window.localStorage.getItem(PROMPT_KEY);
      current = stored ? (JSON.parse(stored) as PromptState) : null;
    } catch {
      current = null;
    }
    writeStoredValue(PROMPT_KEY, JSON.stringify(recordActivity(current, locale)));
  }, [pathname, locale]);

  const asking = !!state && shouldAsk(state, locale);

  if (!asking) return null;

  if (!open) {
    return (
      <Bar
        language={localeInfo(locale).native}
        onOpen={() => setOpen(true)}
        onDismiss={() => persist(dismiss(state))}
      />
    );
  }

  const send = async () => {
    setSending(true);
    const res = await sendTranslationFeedback({
      suggestion,
      path: pathname,
    });
    setSending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    persist(markAnswered(state));
    setOpen(false);
    setSuggestion("");
    toast.success("Thank you — that goes straight to the people fixing it.");
  };

  return (
    <div className="bg-card fixed inset-x-3 bottom-20 z-40 rounded-2xl border p-4 shadow-lg lg:inset-x-auto lg:right-6 lg:bottom-6 lg:w-96">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-bold">
          <Languages aria-hidden className="size-4" />
          Help us fix the {localeInfo(locale).native}
        </p>
        <button
          type="button"
          onClick={() => {
            persist(dismiss(state));
            setOpen(false);
          }}
          aria-label="Close"
          className="text-muted-foreground hover:text-foreground grid size-11 shrink-0 place-items-center rounded-lg sm:size-8"
        >
          <X className="size-4" />
        </button>
      </div>

      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
        Which words or phrases are wrong, and what should they say instead?
        Church words especially — offering, tithe, service, cell group.
      </p>

      <Textarea
        value={suggestion}
        onChange={(e) => setSuggestion(e.target.value)}
        rows={4}
        maxLength={2000}
        className="mt-3"
        placeholder={`e.g. "Offering" should be …`}
        aria-label="What should it say instead?"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={sending || suggestion.trim().length < 2} onClick={send}>
          {sending && <Loader2 className="animate-spin" />}
          Send
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            persist(dismiss(state));
            setOpen(false);
          }}
        >
          Not now
        </Button>
      </div>
    </div>
  );
}

function Bar({
  language,
  onOpen,
  onDismiss,
}: {
  language: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="bg-card fixed inset-x-3 bottom-20 z-40 flex items-center gap-3 rounded-xl border p-3 shadow-lg lg:inset-x-auto lg:right-6 lg:bottom-6 lg:w-80">
      <Languages aria-hidden className="text-primary size-4 shrink-0" />
      <p className="min-w-0 flex-1 text-xs leading-snug">
        Does the {language} read properly? Tell us what to fix.
      </p>
      <Button size="sm" variant="outline" onClick={onOpen}>
        Help
      </Button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Not now"
        className="text-muted-foreground hover:text-foreground grid size-11 shrink-0 place-items-center rounded-lg sm:size-8"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/** One write, which every reader of the store hears about. */
function persist(next: PromptState): void {
  writeStoredValue(PROMPT_KEY, JSON.stringify(next));
}
