"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "fi-install-dismissed";

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Already installed (standalone) or previously dismissed → never show.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!show || !deferred) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  }

  async function install() {
    try {
      await deferred!.prompt();
      await deferred!.userChoice;
    } finally {
      localStorage.setItem(DISMISS_KEY, "1");
      setShow(false);
      setDeferred(null);
    }
  }

  return (
    <div
      className="bg-card animate-in slide-in-from-bottom-4 fixed inset-x-3 z-40 flex items-center gap-3 rounded-2xl border p-3 shadow-xl duration-300 lg:inset-x-auto lg:right-6 lg:w-96"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 5.5rem)" }}
    >
      <Logo className="size-10 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">Install FlockInsight</p>
        <p className="text-muted-foreground truncate text-xs">
          Add it to your home screen for a faster, app-like experience.
        </p>
      </div>
      <Button size="sm" onClick={install}>
        <Download className="size-4" />
        Install
      </Button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="text-muted-foreground hover:text-foreground p-1"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
