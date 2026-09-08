"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";
import { PROMO_TITLE, PROMO_BLURB } from "@/lib/trial";

const KEY = "fi-promo-seen";

/** Wait this long before the offer may appear at all. */
const MIN_DWELL_MS = 15_000;
/** …or this far down the page, whichever the visitor reaches first. */
const SCROLL_TRIGGER = 0.5;

/**
 * A dismissible promo modal, shown once per browsing session — and only to
 * someone who has actually started reading.
 *
 * It used to open 700ms after load, which put a full-screen overlay over the
 * page before most visitors had read a line of it. On a phone that is what
 * Google's page-experience guidance calls an intrusive interstitial, and it is
 * penalised in mobile rankings. It also lands worst on exactly the visitors we
 * care most about: someone on a slow connection sees the popup arrive before
 * the content they were waiting for.
 *
 * So it now waits for a signal of interest — half a page of scrolling, or
 * fifteen seconds on the page. A crawler, and anyone who bounces, never sees
 * it, and the offer reaches the people actually considering it.
 */
export function PromoPopup() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(KEY) === "1";
    } catch {
      /* storage blocked — treat as unseen */
    }
    if (seen) return;

    let done = false;
    const show = () => {
      if (done) return;
      done = true;
      setOpen(true);
    };

    const timer = setTimeout(show, MIN_DWELL_MS);
    const onScroll = () => {
      const scrolled =
        window.scrollY / Math.max(1, document.body.scrollHeight - window.innerHeight);
      if (scrolled >= SCROLL_TRIGGER) show();
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  function close() {
    setOpen(false);
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Promotion"
      onClick={close}
      className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card relative w-full max-w-md overflow-hidden rounded-3xl border shadow-2xl"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="bg-background/70 text-muted-foreground hover:text-foreground absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full backdrop-blur"
        >
          <X className="size-4" />
        </button>

        <div className="from-primary bg-gradient-to-br to-violet-600 px-6 pb-8 pt-10 text-center text-white">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-white/20">
            <Sparkles className="size-6" />
          </div>
          <p className="text-xs font-bold uppercase tracking-wider text-white/80">
            Limited-time launch promo
          </p>
          <h2 className="mt-1 text-2xl font-extrabold leading-tight">{PROMO_TITLE}</h2>
        </div>

        <div className="p-6 text-center">
          <p className="text-muted-foreground">{PROMO_BLURB}</p>
          <Link
            href="/signup"
            onClick={close}
            className="bg-primary text-primary-foreground mt-5 inline-flex w-full items-center justify-center rounded-xl px-6 py-3 text-sm font-bold shadow transition hover:opacity-90"
          >
            Start free — 7 Sundays on us
          </Link>
          <p className="text-muted-foreground mt-3 text-xs">
            No card required. You&apos;ll only pay after your trial if you choose to continue.
          </p>
        </div>
      </div>
    </div>
  );
}
