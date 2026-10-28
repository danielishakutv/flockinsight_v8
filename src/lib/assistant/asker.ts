import "server-only";

import { requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { platformAccess } from "@/lib/platform-access";
import { canReadChurchSummary } from "@/lib/ai/ai-shared";
import type { AskerChurch, AssistantAsker } from "./owner";

/*
 * Who is asking, built ONCE per request from the session and handed to every
 * assistant function, so who pays, which figures may be sent and which rows
 * can be read are all decided from the same object rather than re-derived by
 * each caller. The three kinds, and the tenancy predicate they imply, are in
 * owner.ts.
 */

export {
  messageChurchMatch,
  ownedConversation,
  ownedConversations,
  ownerOf,
  type AskerChurch,
  type AssistantAsker,
  type AssistantScope,
  type ChatOwner,
} from "./owner";

/** The asker from the church shell. A superadmin acting as the church is "actingAs". */
export async function churchShellAsker(): Promise<AssistantAsker> {
  const { user, church, impersonating } = await requireChurch();
  const c: AskerChurch = {
    id: church.id,
    name: church.name,
    plan: church.plan,
    customPlanId: church.customPlanId,
    slug: church.slug,
    isDemo: church.isDemo,
  };
  if (impersonating) return { kind: "actingAs", userId: user.id, userName: user.name ?? "", church: c };
  return {
    kind: "church",
    userId: user.id,
    userName: user.name ?? "",
    church: c,
    // The figures include giving trends and follow-up stages, which sit
    // behind their own permissions: the same gate as the summaries.
    canReadFigures: canReadChurchSummary(await getAccess()),
  };
}

/** The asker from the superadmin shell, or null when this is not an admin. */
export async function platformShellAsker(): Promise<AssistantAsker | null> {
  const access = await platformAccess();
  if (!access) return null;
  return {
    kind: "platform",
    userId: access.id,
    userName: access.name,
    // The same permission the platform briefing needs.
    canReadFigures: access.perms.has("platform.overview.view"),
  };
}
