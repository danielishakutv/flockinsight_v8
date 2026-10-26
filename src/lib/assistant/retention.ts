import "server-only";

import { and, inArray, isNotNull, lt, ne, notInArray, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { aiCall, assistantConversation, assistantMessage } from "@/db/schema";
import { ASSISTANT_DELETED_PURGE_DAYS, ASSISTANT_RETENTION_DAYS } from "@/lib/assistant/shared";

/*
 * The assistant's retention promises, kept by the daily assistant-retention
 * cron:
 *
 *   1. a conversation goes 180 days after its last message, unless the
 *      person saved an answer in it (saved answers are kept until they are
 *      unsaved or the conversation is deleted);
 *   2. a conversation the person deleted goes for good 30 days later, saved
 *      answers and all: they asked for it to go;
 *   3. the stored request and response of every assistant call (feature
 *      "chat" or "advisor") older than 180 days is cleared from the AI
 *      ledger. The row stays, with its tokens, cost and status, because the
 *      money is history; only the scrubbed question, the history and the
 *      figures that were sent are wiped, since keeping them would break the
 *      promise in step 1 by the back door.
 *
 * The same back door is open for step 2: a chat deleted today would still be
 * readable in the ledger for up to 180 days. So when steps 1 and 2 purge a
 * conversation, the ledger rows its answers were written by
 * (assistant_message.call_id) are cleared in the same transaction. Step 3
 * stays as the backstop for calls with no link: rows from before the link
 * existed, the superadmin's test set, an answer whose write failed.
 *
 * Messages cascade with their conversation. An approved canned answer keeps
 * its own copy of the question, so nothing a church relies on expires here.
 * Each step is batched so one run never holds a long lock; anything left goes
 * on the next day's run.
 */

const BATCH = 1000;
const MAX_BATCHES = 20;
const DAY_MS = 86_400_000;

/** What ai_call.request_json reads once its contents have been cleared. Still valid JSON for the call page. */
export const CLEARED_REQUEST_JSON = '{"cleared":"retention"}';

export type RetentionResult = {
  /** Conversations past 180 days with nothing saved in them. */
  expired: number;
  /** Conversations deleted by the person more than 30 days ago. */
  removed: number;
  /** AI ledger rows older than 180 days whose request and response were cleared (step 3). */
  cleared: number;
  /** AI ledger rows cleared because the conversation their answer was in was purged (steps 1 and 2). */
  clearedWithChats: number;
  cutoff: string;
  removedCutoff: string;
  /** A step stopped at its batch limit; the rest goes on the next run. */
  more: boolean;
};

/**
 * Deletes the conversations `where` picks, a batch at a time, and clears the
 * ledger's copy of every call that wrote an answer in them. Each batch is one
 * transaction: the conversations are locked first, so support cannot restore
 * one between its ledger rows being cleared and its rows being deleted, and
 * the call ids are read before the messages that hold them cascade away.
 */
async function deleteConversations(where: SQL): Promise<{ n: number; cleared: number; more: boolean }> {
  let n = 0;
  let cleared = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const done = await db.transaction(async (tx) => {
      const ids = (
        await tx
          .select({ id: assistantConversation.id })
          .from(assistantConversation)
          .where(where)
          .limit(BATCH)
          .for("update")
      ).map((r) => r.id);
      if (ids.length === 0) return { gone: 0, cleared: 0 };
      // A non-correlated subquery: this batch's answers name their calls.
      const wiped = await tx
        .update(aiCall)
        .set({ requestJson: CLEARED_REQUEST_JSON, responseText: null })
        .where(
          and(
            inArray(
              aiCall.id,
              tx
                .select({ id: assistantMessage.callId })
                .from(assistantMessage)
                .where(and(inArray(assistantMessage.conversationId, ids), isNotNull(assistantMessage.callId))),
            ),
            ne(aiCall.requestJson, CLEARED_REQUEST_JSON),
          ),
        )
        .returning({ id: aiCall.id });
      const gone = await tx
        .delete(assistantConversation)
        .where(inArray(assistantConversation.id, ids))
        .returning({ id: assistantConversation.id });
      return { gone: gone.length, cleared: wiped.length };
    });
    n += done.gone;
    cleared += done.cleared;
    if (done.gone < BATCH) return { n, cleared, more: false };
  }
  return { n, cleared, more: true };
}

/**
 * One retention run. `onlyUserIds` narrows every step to those people's rows:
 * the database check passes its own fixture accounts so a test run can never
 * touch a real conversation or ledger row. The cron passes nothing.
 */
export async function runAssistantRetention(input: { now?: Date; onlyUserIds?: string[] } = {}): Promise<RetentionResult> {
  const now = (input.now ?? new Date()).getTime();
  const cutoff = new Date(now - ASSISTANT_RETENTION_DAYS * DAY_MS);
  const removedCutoff = new Date(now - ASSISTANT_DELETED_PURGE_DAYS * DAY_MS);
  const onlyConv = input.onlyUserIds ? inArray(assistantConversation.userId, input.onlyUserIds) : undefined;

  // 1. Old, with nothing saved. NOT IN is safe here: conversation_id is NOT NULL.
  const expired = await deleteConversations(
    and(
      lt(assistantConversation.lastMessageAt, cutoff),
      notInArray(
        assistantConversation.id,
        db
          .select({ id: assistantMessage.conversationId })
          .from(assistantMessage)
          .where(isNotNull(assistantMessage.savedAt)),
      ),
      onlyConv,
    ) as SQL,
  );

  // 2. Deleted by the person, past the grace window.
  const removed = await deleteConversations(
    and(lt(assistantConversation.deletedAt, removedCutoff), onlyConv) as SQL,
  );

  // 3. The ledger's copy of what was sent and what came back.
  let cleared = 0;
  let clearedMore = true;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const done = await db
      .update(aiCall)
      .set({ requestJson: CLEARED_REQUEST_JSON, responseText: null })
      .where(
        inArray(
          aiCall.id,
          db
            .select({ id: aiCall.id })
            .from(aiCall)
            .where(
              and(
                inArray(aiCall.feature, ["chat", "advisor"]),
                lt(aiCall.createdAt, cutoff),
                ne(aiCall.requestJson, CLEARED_REQUEST_JSON),
                input.onlyUserIds ? inArray(aiCall.actorUserId, input.onlyUserIds) : undefined,
              ),
            )
            .limit(BATCH),
        ),
      )
      .returning({ id: aiCall.id });
    cleared += done.length;
    if (done.length < BATCH) {
      clearedMore = false;
      break;
    }
  }

  return {
    expired: expired.n,
    removed: removed.n,
    cleared,
    clearedWithChats: expired.cleared + removed.cleared,
    cutoff: cutoff.toISOString(),
    removedCutoff: removedCutoff.toISOString(),
    more: expired.more || removed.more || clearedMore,
  };
}
