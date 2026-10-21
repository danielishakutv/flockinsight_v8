"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useOptionalT } from "@/components/i18n-provider";
import type { Dictionary, PartialDictionary } from "@/lib/i18n/dictionaries/en";
import { makeT, type TFunction } from "@/lib/i18n/translate";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AssistantPanel } from "@/components/assistant/assistant-panel";

export type AssistantScope = "church" | "platform";

type AssistantContext = {
  open: () => void;
  close: () => void;
  available: boolean;
  scope: AssistantScope;
  t: TFunction;
};

const Ctx = createContext<AssistantContext | null>(null);

/** The assistant, or null where no provider is mounted (the button and menu item then hide). */
export function useAssistant(): AssistantContext | null {
  return useContext(Ctx);
}

/**
 * Holds the help assistant's open state for a whole shell, so the desktop top
 * bar, the avatar menu and the Help page card all open the same panel.
 *
 * The panel is a Radix Dialog, which portals to document.body. That is not a
 * detail: both top bars and the superadmin header use backdrop-blur, which
 * makes them the containing block for any fixed child, and a panel rendered
 * inside one would open as a sliver the height of the header.
 *
 * The church shell has an I18nProvider, so its words come from useT(). The
 * superadmin shell deliberately has none, and the empty fallback would
 * humanise keys ("Not in guides"), so that layout passes the English
 * assistant strings and a real English t is built from them here.
 */
export function AssistantProvider({
  scope,
  available,
  strings,
  children,
}: {
  scope: AssistantScope;
  available: boolean;
  strings?: Dictionary["assistant"];
  children: React.ReactNode;
}) {
  const shellT = useOptionalT();
  const t = useMemo(
    () => (strings ? makeT("en", { assistant: strings } as PartialDictionary) : shellT),
    [strings, shellT],
  );
  /*
   * Open means "open on the page it was opened on". A source chip or a link
   * in an answer navigates underneath the panel, and on a phone the panel
   * covers the whole screen, so the page they asked for would never be seen.
   * Deriving it from the path closes the panel on any navigation, with no
   * effect to keep in step.
   */
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const isOpen = openOn !== null && openOn === pathname;
  const open = useCallback(() => setOpenOn(pathname), [pathname]);
  const close = useCallback(() => setOpenOn(null), []);
  const setOpen = useCallback(
    (next: boolean) => setOpenOn(next ? pathname : null),
    [pathname],
  );
  const value = useMemo(
    () => ({ open, close, available, scope, t }),
    [open, close, available, scope, t],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {available && (
        <Dialog open={isOpen} onOpenChange={setOpen}>
          <DialogContent
            className="top-0 left-0 h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 p-0 sm:top-0 sm:right-0 sm:left-auto sm:max-h-dvh sm:max-w-md sm:border-l"
            aria-describedby="assistant-intro"
          >
            <DialogTitle className="sr-only">{t("assistant.helpAssistant")}</DialogTitle>
            <DialogDescription id="assistant-intro" className="sr-only">
              {t("assistant.intro")}
            </DialogDescription>
            {isOpen && <AssistantPanel scope={scope} t={t} />}
          </DialogContent>
        </Dialog>
      )}
    </Ctx.Provider>
  );
}
