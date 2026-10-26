"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircleQuestionMark } from "lucide-react";
import { useAssistant } from "@/components/assistant/assistant-provider";
import { Button } from "@/components/ui/button";

/**
 * The icon link to the assistant's page: in the desktop top bar, before the
 * bell, and beside the command-palette hint in the superadmin header. Not in
 * the mobile top bar, which is already at its four-control width; phones
 * reach the assistant from the avatar menu, the menu sheet and the Help page.
 */
export function AssistantButton() {
  const assistant = useAssistant();
  const pathname = usePathname();
  if (!assistant?.available) return null;
  const here = pathname === assistant.href;
  return (
    <Button
      variant="ghost"
      size="icon"
      asChild
      className={here ? "bg-accent" : undefined}
      aria-label={assistant.t("assistant.ask")}
      title={assistant.t("assistant.openAssistant")}
    >
      <Link href={assistant.href} aria-current={here ? "page" : undefined}>
        <MessageCircleQuestionMark className="size-5" />
      </Link>
    </Button>
  );
}
