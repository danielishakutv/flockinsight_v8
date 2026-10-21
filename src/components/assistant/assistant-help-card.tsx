"use client";

import { ArrowRight, MessageCircleQuestionMark } from "lucide-react";
import { useAssistant } from "@/components/assistant/assistant-provider";

/**
 * The "Ask a question" quick-action card on /help. Styled as a sibling of the
 * page's other quick-action cards, and hidden wherever the assistant is not
 * available (the demo church), rather than shown and then refusing.
 */
export function AssistantHelpCard() {
  const assistant = useAssistant();
  if (!assistant?.available) return null;
  const { t } = assistant;
  return (
    <button
      type="button"
      onClick={assistant.open}
      className="bg-card group flex items-center gap-4 rounded-2xl border p-5 text-left shadow-sm transition hover:shadow-md"
    >
      <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
        <MessageCircleQuestionMark className="size-6" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="group-hover:text-primary font-bold">{t("assistant.askAQuestion")}</p>
        <p className="text-muted-foreground text-sm">{t("assistant.askAQuestionBlurb")}</p>
      </div>
      <ArrowRight className="text-muted-foreground size-5 transition group-hover:translate-x-0.5" />
    </button>
  );
}
