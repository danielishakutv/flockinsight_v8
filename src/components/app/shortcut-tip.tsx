"use client";

import { useEffect, useRef, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { chooseTip, markShown, markVisit, turnTipsOff } from "@/lib/shortcut-tips";
import { MNEMONICS } from "@/lib/shortcut-mnemonics";
import type { Shortcut } from "@/lib/shortcuts";
import { useHasKeyboard, useTipState } from "@/lib/use-shortcut-tips";
import { TEACH_EVENT } from "@/lib/shortcut-teach";
import { useT } from "@/components/i18n-provider";
import { useIsMac } from "@/lib/use-is-mac";
import { Keys } from "@/components/app/shortcut-sheet";

/**
 * "Next time, press G then M."
 *
 * One shortcut, at the moment it would have helped, at most six times ever,
 * and never again once the person has used it. The rules all live in
 * `lib/shortcut-tips.ts`, where they are tested; this is the fifteen seconds
 * of screen time they earn.
 *
 * Deliberately NOT a toast and NOT a modal. A toast stacks with the real ones
 * — "Member added" matters and this does not, so they must not compete — and a
 * modal would be an outrage for something nobody asked for. It is a small card
 * in the bottom-left corner, which on every page in this app is empty space,
 * clear of the mobile tab bar and of the primary action bottom-right.
 *
 * Split in two on purpose. The outer component decides WHETHER to teach
 * something; the inner one is the card, mounted under a key, so its whole
 * lifecycle — the delay, the linger, the fade — is just "being mounted". The
 * alternative was resetting three pieces of state at the top of an effect
 * every time the candidate changed, which is the cascading-render shape this
 * codebase has already been bitten by.
 */
export function ShortcutTip({
  pathname,
  available,
  onOpenSheet,
}: {
  pathname: string;
  available: readonly Shortcut[];
  onOpenSheet: () => void;
}) {
  const hasKeyboard = useHasKeyboard();
  const { update, read } = useTipState();
  const [candidate, setCandidate] = useState<Shortcut | null>(null);

  /*
   * One visit counted per page, and one decision per page.
   *
   * Keyed on the pathname so navigating counts as a new visit, which is what
   * "visits" is supposed to measure. The ref stops the count climbing again
   * when this re-renders for any other reason — a storage write, a media query
   * change — which would otherwise let somebody reach the eight-visit
   * threshold without going anywhere.
   */
  const countedRef = useRef<string | null>(null);

  /*
   * What the `teach` listener needs. It is attached once, with no
   * dependencies, so that a click never races a re-subscribe — everything it
   * reads comes through these, synced in an effect that is declared first.
   */
  const pathnameRef = useRef(pathname);
  const availableRef = useRef(available);
  const keyboardRef = useRef(hasKeyboard);
  const readRef = useRef(read);
  useEffect(() => {
    pathnameRef.current = pathname;
    availableRef.current = available;
    keyboardRef.current = hasKeyboard;
    readRef.current = read;
  });

  useEffect(() => {
    if (countedRef.current === pathname) return;
    countedRef.current = pathname;

    const visited = update(markVisit);
    setCandidate(
      chooseTip({
        pathname,
        state: visited,
        now: Date.now(),
        available,
        hasKeyboard,
      }),
    );
  }, [pathname, hasKeyboard, available, update]);

  /*
   * The other way a tip arrives: somebody just did by hand a thing that has a
   * key. See `lib/shortcut-teach.ts`.
   *
   * The same `chooseTip` decides, so every rule still holds — this only names
   * which shortcut goes to the front of the queue. A `prefer` the person has
   * already learned returns null, so a click on a button whose key they know
   * is met with silence rather than a tip about something else.
   */
  useEffect(() => {
    function onTaught(e: Event) {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id !== "string") return;
      setCandidate((current) =>
        /*
         * Never interrupts a tip already on its way up. Two cards fighting
         * over the same corner is worse than missing one, and the one already
         * queued was chosen for a reason too.
         */
        current ??
        chooseTip({
          pathname: pathnameRef.current,
          state: readRef.current(),
          now: Date.now(),
          available: availableRef.current,
          hasKeyboard: keyboardRef.current,
          prefer: id,
        }),
      );
    }
    window.addEventListener(TEACH_EVENT, onTaught);
    return () => window.removeEventListener(TEACH_EVENT, onTaught);
  }, []);

  if (!candidate) return null;

  return (
    <TipCard
      // A new candidate is a new card, with a fresh timer and no leftover
      // fade. Remounting says that in one line.
      key={`${pathname}:${candidate.id}`}
      tip={candidate}
      onShown={() => update((s) => markShown(s, candidate.id, Date.now()))}
      onTurnOff={() => update(turnTipsOff)}
      onOpenSheet={onOpenSheet}
      onGone={() => setCandidate(null)}
    />
  );
}

/** Long enough that the page has settled and the person has looked at it. */
const APPEAR_AFTER_MS = 4500;

/** And then it goes away by itself. Nothing this minor should need dismissing. */
const LINGER_MS = 16_000;

/** The fade out. */
const FADE_MS = 400;

type Phase = "waiting" | "showing" | "leaving";

function TipCard({
  tip,
  onShown,
  onTurnOff,
  onOpenSheet,
  onGone,
}: {
  tip: Shortcut;
  onShown: () => void;
  onTurnOff: () => void;
  onOpenSheet: () => void;
  onGone: () => void;
}) {
  const t = useT();
  const isMac = useIsMac();
  const [phase, setPhase] = useState<Phase>("waiting");

  /*
   * The callbacks, read through refs by the timers below.
   *
   * Written in an effect rather than during render: a ref assigned while
   * rendering is both a lint error in this project and a real hazard, since a
   * render React throws away would still have mutated it. Declared ahead of
   * the effect that reads them, which is the order the rule wants — the sync
   * must have happened before anything depends on it.
   */
  const onShownRef = useRef(onShown);
  const onGoneRef = useRef(onGone);
  useEffect(() => {
    onShownRef.current = onShown;
    onGoneRef.current = onGone;
  });

  /*
   * The whole life of the card, in one effect with no dependencies.
   *
   * It runs once per mount, and the key on this component guarantees a new
   * mount per candidate — so there is no state to reset, and nothing here can
   * restart a timer halfway through.
   */
  useEffect(() => {
    const appear = setTimeout(() => {
      setPhase("showing");
      /*
       * Recorded as shown when it actually appears, not when it was chosen.
       * Somebody who clicks away after two seconds has not been shown
       * anything, and spending one of their six on a card they never saw would
       * be the feature quietly wasting itself.
       */
      onShownRef.current();
    }, APPEAR_AFTER_MS);

    const hide = setTimeout(() => setPhase("leaving"), APPEAR_AFTER_MS + LINGER_MS);
    const gone = setTimeout(
      () => onGoneRef.current(),
      APPEAR_AFTER_MS + LINGER_MS + FADE_MS,
    );

    return () => {
      clearTimeout(appear);
      clearTimeout(hide);
      clearTimeout(gone);
    };
  }, []);

  if (phase === "waiting") return null;

  const mnemonic = MNEMONICS[tip.id];

  function dismiss() {
    setPhase("leaving");
    setTimeout(() => onGoneRef.current(), FADE_MS);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t("shortcuts.tipAriaLabel")}
      className={[
        // Bottom-left: empty on every page in this app, clear of the mobile
        // tab bar and of the primary action bottom-right. Desktop only —
        // there is nothing to teach without a keyboard.
        "fixed bottom-4 left-4 z-40 hidden w-[20rem] lg:block",
        "bg-card/95 rounded-2xl border p-3.5 shadow-lg backdrop-blur",
        "transition-all duration-300 motion-reduce:transition-none",
        phase === "leaving"
          ? "pointer-events-none translate-y-2 opacity-0"
          : "translate-y-0 opacity-100",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <span className="bg-primary/15 text-primary grid size-8 shrink-0 place-items-center rounded-lg">
          <Keyboard className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
            {t("shortcuts.tipEyebrow")}
          </p>

          <p className="mt-0.5 text-sm leading-snug font-semibold">
            {t(tip.labelKey)}
          </p>

          <p className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span>{t("shortcuts.tipLead")}</span>
            <Keys keys={tip.keys} isMac={isMac} then={t("shortcuts.then")} />
          </p>

          {mnemonic && (
            <p className="text-muted-foreground mt-1 text-[11px]">{t(mnemonic)}</p>
          )}

          <div className="mt-2.5 flex items-center gap-3 text-[11px] font-semibold">
            <button
              type="button"
              onClick={dismiss}
              className="text-primary hover:underline"
            >
              {t("shortcuts.tipGotIt")}
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenSheet();
                dismiss();
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              {t("shortcuts.tipSeeAll")}
            </button>
            {/*
              The way out, said plainly and honoured permanently. Something
              nobody asked for must be easy to end, or it is not a tip, it is
              an advert. Settings can switch it back on.
            */}
            <button
              type="button"
              onClick={() => {
                onTurnOff();
                dismiss();
              }}
              className="text-muted-foreground hover:text-foreground ml-auto"
            >
              {t("shortcuts.tipTurnOff")}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label={t("app.dismiss")}
          className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 shrink-0"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
