import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { BookOpen } from "lucide-react";
import { requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { hasFeature } from "@/lib/entitlements-server";
import { PLAN_ORDER, planRank } from "@/lib/entitlements";
import { getAssistantAllowances } from "@/lib/ai/settings";
import { monthlyAllowanceFor } from "@/lib/assistant/advisor-shared";
import { getT } from "@/lib/i18n/server";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { PlanGate } from "@/components/app/plan-gate";
import { Button } from "@/components/ui/button";
import { ChatWorkspace } from "@/components/assistant/chat-workspace";
import type { ChatLinks } from "@/components/assistant/chat-context";
import { firstParam, tabFromParam } from "@/components/assistant/chat-shared";
import { loadChatState } from "./actions";

/** Always current: a chat asked on a phone should be in the history on the next load. */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("assistantPage.title") };
}

/**
 * The assistant's page: one chat at a time, the history beside it, saved
 * answers, and downloads. The URL holds the state (?c=<chat>, ?tab=saved),
 * so what it names is loaded here, before the first paint, and a reload or a
 * shared link lands on it.
 *
 * Any staff login may open it, as /help is open to any staff login. The
 * server decides per question whether an answer may use the church's
 * figures (the plan, the rollout, the person's role, the owner's consent),
 * and the page shows which mode is on and why.
 *
 * Off-plan the page stays readable under the PlanGate banner and only asking
 * is refused: nobody's own questions become unreachable or undeletable
 * because a plan changed.
 */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { church, impersonating } = await requireChurch();
  const t = await getT();

  // The demo church is shared by strangers and resets every two hours: it never asks.
  if (church.isDemo) {
    return (
      <PageContainer>
        <PageHeader title={t("assistantPage.title")} />
        <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm" role="status">
          <p className="font-medium">{t("assistant.notInDemo")}</p>
          <Button variant="outline" asChild>
            <Link href="/help">
              <BookOpen className="size-4" />
              {t("assistant.browseGuides")}
            </Link>
          </Button>
        </div>
      </PageContainer>
    );
  }

  const params = await searchParams;
  const tab = tabFromParam(params.tab);
  const [access, onPlan, initial, allowances] = await Promise.all([
    getAccess(),
    hasFeature("assistant"),
    loadChatState({ conversationId: tab === "saved" ? null : firstParam(params.c), tab }),
    getAssistantAllowances(),
  ]);

  /*
   * "Upgrade for more questions" only when buying a plan would actually give
   * more: a higher plan whose month (as the allowances in force set it) is
   * larger, or has no ceiling. Enterprise, or a top allowance an admin set
   * on a lower plan, gets the support ticket instead (chat-composer.tsx).
   */
  const month = monthlyAllowanceFor(church.plan, allowances);
  const morePlanExists =
    month !== null &&
    PLAN_ORDER.slice(planRank(church.plan) + 1).some((p) => {
      const higher = monthlyAllowanceFor(p, allowances);
      return higher === null || higher > month;
    });

  const links: ChatLinks = {
    base: "/assistant",
    exportBase: "/assistant/export",
    // Each link only for the person who can act on it: billing for whoever manages it.
    upgrade: (access.isOwner || access.perms.has("settings.manage")) && morePlanExists ? "/settings/billing" : null,
    // AI consent is the owner's own decision; a superadmin acting as the church cannot give it.
    consent: access.isOwner && !impersonating ? "/settings/ai" : null,
    guides: "/help",
    support: "/help/support",
  };

  /*
   * A fresh key on every server render, so every real navigation here (the
   * sidebar's Assistant, the top bar button, the avatar menu, all Links to
   * /assistant) starts the workspace from what this render loaded for its
   * URL. Its state is seeded once from `initial`, and Next keeps a client
   * component's state across a search-params-only navigation, so without
   * this a click on "Assistant" from ?c=<chat> showed the old chat under the
   * new URL. The workspace's own pushState never re-renders this page, so
   * moving between chats inside it does not remount anything.
   */
  return (
    <>
      {!onPlan && (
        <div className="px-4 pt-6 lg:px-8">
          <PlanGate feature="assistant" />
        </div>
      )}
      <ChatWorkspace key={randomUUID()} scope="church" initial={initial} initialTab={tab} links={links} />
    </>
  );
}
