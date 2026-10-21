"use client";

import { MessageCircleQuestionMark } from "lucide-react";
import { useAssistant } from "@/components/assistant/assistant-provider";
import { Button } from "@/components/ui/button";

/**
 * The icon button that opens the help assistant: in the desktop top bar,
 * before the bell, and beside the command-palette hint in the superadmin
 * header. Not in the mobile top bar, which is already at its four-control
 * width; phones reach the assistant from the avatar menu and the Help page.
 */
export function AssistantButton() {
  const assistant = useAssistant();
  if (!assistant?.available) return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={assistant.open}
      aria-label={assistant.t("assistant.ask")}
      title={assistant.t("assistant.helpAssistant")}
    >
      <MessageCircleQuestionMark className="size-5" />
    </Button>
  );
}
