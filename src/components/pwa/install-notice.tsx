"use client";

import { useState } from "react";
import { Download, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IOSSteps } from "@/components/pwa/install-prompt";
import { requestInstall, useInstall } from "@/components/pwa/use-install";

/**
 * A quiet line on the dashboard that stays until the app is installed.
 *
 * The pop-up asks occasionally and then leaves people alone; this is the
 * opposite — it never interrupts, and it never goes away, so installing is
 * always one tap from the first screen someone sees. Between them nobody has
 * to remember the app can be installed, and nobody gets nagged.
 *
 * Sized to be ignorable: one line, one button, no card shadow, no colour
 * shouting for attention. It sits above the page rather than inside the
 * content, and disappears the moment it is no longer true.
 */
export function InstallNotice() {
  const { standalone, route, installed } = useInstall();
  const [showIOS, setShowIOS] = useState(false);

  // Nothing to say if they already have it, or if this browser cannot.
  if (standalone || installed || route === "unsupported") return null;

  async function onInstall() {
    if (route === "ios") {
      setShowIOS((v) => !v);
      return;
    }
    await requestInstall();
  }

  return (
    <div className="border-primary/20 bg-primary/5 mb-4 rounded-xl border px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Smartphone className="text-primary size-4 shrink-0" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">Install FlockInsight</span>{" "}
          <span className="text-muted-foreground">
            — open it from your home screen, and keep working when the network
            drops.
          </span>
        </p>
        <Button size="sm" variant="outline" onClick={onInstall}>
          <Download className="size-3.5" />
          {route === "ios" ? (showIOS ? "Hide steps" : "How") : "Install"}
        </Button>
      </div>
      {showIOS && <IOSSteps />}
    </div>
  );
}
