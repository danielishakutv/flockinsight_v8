"use client";

import { createContext, useContext, useMemo } from "react";
import { useOptionalT } from "@/components/i18n-provider";
import type { Dictionary, PartialDictionary } from "@/lib/i18n/dictionaries/en";
import { makeT, type TFunction } from "@/lib/i18n/translate";

export type AssistantScope = "church" | "platform";

type AssistantContext = {
  available: boolean;
  scope: AssistantScope;
  /** Where the assistant lives in this shell: its own page. */
  href: string;
  t: TFunction;
};

const Ctx = createContext<AssistantContext | null>(null);

/** The assistant, or null where no provider is mounted (the button, menu item and card then hide). */
export function useAssistant(): AssistantContext | null {
  return useContext(Ctx);
}

/** Each shell's assistant page. */
export const ASSISTANT_HREF: Record<AssistantScope, string> = {
  church: "/assistant",
  platform: "/superadmin/ask",
};

/**
 * Tells a whole shell whether the assistant is offered and where it is, so
 * the desktop top bar, the avatar menu and the Help page card all agree.
 *
 * It used to hold a side panel too, a Radix Dialog docked to the right. The
 * assistant is a page of its own now (/assistant, /superadmin/ask) with its
 * history, saved answers and downloads, and every entry point is a link to
 * it; the panel (assistant-panel.tsx) is retired.
 *
 * The church shell has an I18nProvider, so its words come from useT(). The
 * superadmin shell deliberately has none, and the empty fallback would
 * humanise keys ("Ask"), so that layout passes the English assistant strings
 * and a real English t is built from them here.
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
  const value = useMemo(
    () => ({ available, scope, href: ASSISTANT_HREF[scope], t }),
    [available, scope, t],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
