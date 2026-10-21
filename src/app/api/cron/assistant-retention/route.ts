import { inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { assistantConversation } from "@/db/schema";
import { withCronRun } from "@/lib/cron-run";
import { ASSISTANT_RETENTION_DAYS } from "@/lib/assistant/shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BATCH = 1000;
const MAX_BATCHES = 20;

/**
 * GET /api/cron/assistant-retention, daily. Keeps the promise the assistant's
 * privacy line makes: a conversation is deleted 180 days after its last
 * message, and its messages cascade with it. An approved canned answer keeps
 * its own copy of the question, so nothing a church relies on expires here.
 *
 * Batched so one run never holds a long lock; anything left over goes on the
 * next day's run, and the count is on the cron_run row either way.
 * Auth via ?key=CRON_SECRET or a Bearer header.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const key =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("key");
  if (!secret || key !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  return withCronRun("assistant-retention", async () => {
    const cutoff = new Date(Date.now() - ASSISTANT_RETENTION_DAYS * 86_400_000);
    let deleted = 0;
    let batches = 0;
    for (; batches < MAX_BATCHES; batches++) {
      // A non-correlated subquery: the ids are chosen first, then deleted.
      const gone = await db
        .delete(assistantConversation)
        .where(
          inArray(
            assistantConversation.id,
            db
              .select({ id: assistantConversation.id })
              .from(assistantConversation)
              .where(lt(assistantConversation.lastMessageAt, cutoff))
              .limit(BATCH),
          ),
        )
        .returning({ id: assistantConversation.id });
      deleted += gone.length;
      if (gone.length < BATCH) break;
    }
    return Response.json({
      ok: true,
      deleted,
      cutoff: cutoff.toISOString(),
      more: batches === MAX_BATCHES,
    });
  });
}
