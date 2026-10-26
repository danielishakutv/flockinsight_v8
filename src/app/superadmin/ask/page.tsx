import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { platformAccess } from "@/lib/platform-access";
import { en } from "@/lib/i18n/dictionaries/en";
import { ChatWorkspace, type ChatCopy, type ChatStrings } from "@/components/assistant/chat-workspace";
import type { ChatLinks } from "@/components/assistant/chat-context";
import { firstParam, tabFromParam } from "@/components/assistant/chat-shared";
import { loadChatState } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ask" };

/*
 * The superadmin shell's links. No guides, support or billing pages of its
 * own (/help lives behind requireChurch), and no church to consent for.
 */
const LINKS: ChatLinks = {
  base: "/superadmin/ask",
  exportBase: "/superadmin/ask/export",
  upgrade: null,
  consent: null,
  guides: null,
  support: null,
};

/*
 * The empty chat in an operator's words. The church page's suggestions are
 * about one church's attendance; here the advisor reads the platform's
 * figures, which name no church and no person.
 */
const COPY: ChatCopy = {
  introAdvisor:
    "Ask about the platform's growth, activation, retention and usage, and what to prioritise. Answers use the platform's figures (counts and percentages, no church or person named) and the help guides.",
  introHelp: "Ask how something works in FlockInsight. Answers come from the same help guides the churches read.",
  suggestionsAdvisor: [
    "How do sign-ups this month compare with last month?",
    "Where are churches dropping off after they sign up?",
    "What should support prioritise this week?",
    "How does a church record attendance?",
  ],
  suggestionsHelp: [
    "How does a church record attendance for two services?",
    "How does a church import members from a spreadsheet?",
    "How does a church send an SMS to one group?",
    "How is a first-timer assigned for follow-up?",
  ],
};

/*
 * The page's English, with the church page's words about "your church's
 * figures" said the way they are here: the advisor reads the platform's
 * figures, and what an admin can lose is the dashboard permission, not a
 * church's data.
 */
const STRINGS: ChatStrings = {
  assistant: en.assistant,
  assistantPage: {
    ...en.assistantPage,
    modeAdvisorHint: "Answers use the platform's figures (no church or person named) and the help guides.",
    yourFigures: "Platform figures",
    figuresNote: "Some figures could not be checked against the platform's records.",
    pendingAdvisor: "Looking at the platform's figures…",
    pdfWithheld:
      "This answer was written from the platform's figures, which need the dashboard permission (platform.overview.view), so it can't be downloaded.",
    answerWithheld:
      "This answer was written from the platform's figures, which need the dashboard permission (platform.overview.view), so it isn't shown.",
    answersLeftOut: {
      one: "{count} answer was left out: it was written from the platform's figures, which need the dashboard permission (platform.overview.view).",
      other:
        "{count} answers were left out: they were written from the platform's figures, which need the dashboard permission (platform.overview.view).",
    },
  },
};

/**
 * /superadmin/ask: the assistant for FlockInsight's own operators, under the
 * platform scope and budget and each admin's own day. Any admin may ask;
 * answers about the platform's figures need platform.overview.view, and the
 * page says so when they are coming from the guides instead.
 *
 * English only, like the rest of this shell: the two dictionary sections the
 * page reads are passed in as plain English objects.
 */
export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await platformAccess())) redirect("/dashboard");
  const params = await searchParams;
  const tab = tabFromParam(params.tab);
  const initial = await loadChatState({ conversationId: tab === "saved" ? null : firstParam(params.c), tab });

  // A fresh key per server render, so a real navigation here remounts the workspace (see the church page).
  return (
    <ChatWorkspace
      key={randomUUID()}
      scope="platform"
      initial={initial}
      initialTab={tab}
      links={LINKS}
      strings={STRINGS}
      copy={COPY}
    />
  );
}
