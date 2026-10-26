"use client";

import { createContext, useContext } from "react";
import type { TFunction } from "@/lib/i18n/translate";
import type { AssistantSource } from "@/lib/assistant/shared";

export type ChatScope = "church" | "platform";

/**
 * Where the page's links go. Null hides the link: the superadmin shell has
 * no guides, support or billing pages of its own, and only the people who
 * can act on a link see it (billing for those who manage it, AI consent for
 * the owner alone).
 */
export type ChatLinks = {
  /** The page itself: "/assistant" or "/superadmin/ask". */
  base: string;
  /** The PDF route for a chat or one answer. */
  exportBase: string;
  upgrade: string | null;
  consent: string | null;
  guides: string | null;
  support: string | null;
};

type ChatContextValue = {
  t: TFunction;
  scope: ChatScope;
  links: ChatLinks;
};

const Ctx = createContext<ChatContextValue | null>(null);

export const ChatProvider = Ctx.Provider;

/** The workspace's words, shell and links, for its pieces. Only ever used under ChatWorkspace. */
export function useChat(): ChatContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChat() needs the ChatWorkspace above it.");
  return ctx;
}

/**
 * What a source chip says. The server's titles are English, so the two that
 * are words rather than guide names are translated here, by ref.
 */
export function sourceTitle(t: TFunction, s: AssistantSource): string {
  if (s.ref === "facts") return t("assistantPage.yourFigures");
  if (s.ref.startsWith("answer:")) return t("assistantPage.approvedAnswer");
  return s.title;
}
