import "server-only";

import { and, eq, isNull, type SQL } from "drizzle-orm";
import { assistantConversation, assistantMessage } from "@/db/schema";

/*
 * Who is asking, as the assistant's server code sees it, and the one tenancy
 * predicate over conversations. Kept apart from asker.ts (which builds the
 * asker from the session) so the server core and the database checks can use
 * them without loading the session and auth modules.
 *
 *   church    a staff member in their own church. Scope "church": charged to
 *             the church, counted against its month, its figures when the
 *             rules allow.
 *   actingAs  a superadmin acting as a church. Support, not the church: scope
 *             "platform", charged to the platform and the admin's own day,
 *             never the church's month. The conversation remembers which
 *             church it was about (context_church_id), and the advisor may
 *             use that church's figures only if its owner opted in.
 *   platform  a superadmin on /superadmin. Scope "platform", the platform's
 *             own figures when they hold platform.overview.view.
 */

export type AskerChurch = {
  id: string;
  name: string;
  plan: string | null;
  customPlanId: string | null;
  slug: string | null;
  isDemo: boolean | null;
};

export type AssistantAsker =
  | { kind: "church"; userId: string; userName: string; church: AskerChurch; canReadFigures: boolean }
  | { kind: "actingAs"; userId: string; userName: string; church: AskerChurch }
  | { kind: "platform"; userId: string; userName: string; canReadFigures: boolean };

export type AssistantScope = "church" | "platform";

/** What a conversation row records about its owner. */
export type ChatOwner = {
  scope: AssistantScope;
  churchId: string | null;
  contextChurchId: string | null;
  userId: string;
};

export function ownerOf(a: AssistantAsker): ChatOwner {
  switch (a.kind) {
    case "church":
      return { scope: "church", churchId: a.church.id, contextChurchId: null, userId: a.userId };
    case "actingAs":
      return { scope: "platform", churchId: null, contextChurchId: a.church.id, userId: a.userId };
    case "platform":
      return { scope: "platform", churchId: null, contextChurchId: null, userId: a.userId };
  }
}

/**
 * The tenancy predicate, the same everywhere: one person AND one scope, a
 * church conversation to one church, and a superadmin's conversations kept
 * apart by the church they were acting as (none, for /superadmin), so one
 * church's figures are never replayed as history into a question about
 * another. Deleted conversations are gone from the person's view the moment
 * they delete them. A foreign or unknown id simply matches nothing.
 */
export function ownedConversations(o: ChatOwner): SQL {
  return and(
    eq(assistantConversation.userId, o.userId),
    eq(assistantConversation.scope, o.scope),
    o.churchId ? eq(assistantConversation.churchId, o.churchId) : isNull(assistantConversation.churchId),
    o.contextChurchId
      ? eq(assistantConversation.contextChurchId, o.contextChurchId)
      : isNull(assistantConversation.contextChurchId),
    isNull(assistantConversation.deletedAt),
  ) as SQL;
}

export function ownedConversation(o: ChatOwner, conversationId: string): SQL {
  return and(eq(assistantConversation.id, conversationId), ownedConversations(o)) as SQL;
}

/** Message reads repeat the church predicate on the message row itself. */
export function messageChurchMatch(o: ChatOwner): SQL {
  return o.churchId ? eq(assistantMessage.churchId, o.churchId) : isNull(assistantMessage.churchId);
}
