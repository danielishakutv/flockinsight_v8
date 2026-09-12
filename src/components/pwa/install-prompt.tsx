"use client";

import { useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  dismissInstall,
  requestInstall,
  useInstall,
} from "@/components/pwa/use-install";

/**
 * The occasional nudge to install.
 *
 * Appears once someone has come back to the app and been left alone for a
 * while — never on a first visit, never on first paint. A "no" is remembered
 * and the gap before asking again grows; see lib/pwa-install.
 *
 * On iPhone there is no install API to call, so the button opens the two-line
 * recipe instead. That is the whole reason this is not just a button: Safari
 * never fires `beforeinstallprompt`, and the old version of this component
 * rendered nothing at all on iOS as a result.
 */
export function InstallPrompt() {
  const { standalone, route, mayAsk } = useInstall();
  const [showIOS, setShowIOS] = useState(false);

  if (standalone || !mayAsk || route === "unsupported") return null;

  async function onInstall() {
    if (route === "ios") {
      setShowIOS(true);
      return;
    }
    await requestInstall();
  }

  return (
    <div
      className="bg-card animate-in slide-in-from-bottom-4 fixed inset-x-3 z-40 rounded-2xl border p-3 shadow-xl duration-300 lg:inset-x-auto lg:right-6 lg:w-96"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 5.5rem)" }}
      role="dialog"
      aria-label="Install FlockInsight"
    >
      <div className="flex items-center gap-3">
        <Logo className="size-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Install FlockInsight</p>
          <p className="text-muted-foreground text-xs">
            Opens like an app, works offline, and starts faster.
          </p>
        </div>
        {!showIOS && (
          <Button size="sm" onClick={onInstall}>
            <Download className="size-4" />
            Install
          </Button>
        )}
        <button
          onClick={dismissInstall}
          aria-label="Not now"
          className="text-muted-foreground hover:text-foreground p-1"
        >
          <X className="size-4" />
        </button>
      </div>

      {showIOS && <IOSSteps />}
    </div>
  );
}

/**
 * What to tap on an iPhone.
 *
 * Deliberately names the icons rather than describing them — "the square with
 * an arrow" is how everyone actually finds the Share button.
 */
export function IOSSteps({ className }: { className?: string }) {
  return (
    <ol className={`mt-3 space-y-2 border-t pt-3 text-xs ${className ?? ""}`}>
      <li className="flex items-center gap-2">
        <span className="bg-muted grid size-5 shrink-0 place-items-center rounded-full font-bold">
          1
        </span>
        <span className="flex items-center gap-1.5">
          Tap <Share className="size-3.5 shrink-0" />
          <span className="font-semibold">Share</span> at the bottom of Safari
        </span>
      </li>
      <li className="flex items-center gap-2">
        <span className="bg-muted grid size-5 shrink-0 place-items-center rounded-full font-bold">
          2
        </span>
        <span className="flex items-center gap-1.5">
          Choose <SquarePlus className="size-3.5 shrink-0" />
          <span className="font-semibold">Add to Home Screen</span>
        </span>
      </li>
    </ol>
  );
}
