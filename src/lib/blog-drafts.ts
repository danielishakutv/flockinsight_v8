import "server-only";

import { revalidatePath } from "next/cache";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { blogDraftRun, blogPost } from "@/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { auditSystem, recordAudit } from "@/lib/audit";
import { excerptFromBody, uniqueBlogSlug } from "@/lib/blog";
import { aiReadiness, runAi } from "@/lib/ai/run-ai";
import { scrubFreeText } from "@/lib/ai/safe-text";
import { MODELS } from "@/lib/ai/config";
import { BLOG_TOPICS, findTopic, nextTopic, type BlogTopic } from "@/lib/seo/blog-topics";
import {
  BLOG_MAX_TOKENS,
  BLOG_PROMPT_ID,
  buildBlogDraftPrompt,
  isoWeekKey,
  parseBlogDraft,
} from "@/lib/blog-draft-shared";

/**
 * The weekly blog drafter.
 *
 * It NEVER publishes. The only blog_post status this module writes is
 * "draft", the public blog queries already filter status = 'published', and
 * savePost/setPostStatus refuse an AI post nobody has read. A human publishes
 * through the existing editor or nothing goes out.
 */

/** A run row goes stale (and may be reclaimed or shown as interrupted) after this. */
export const STALE_RUN_MINUTES = 30;
const MAX_SCHEDULED_ATTEMPTS = 3;
const DRAFTER_NAME = "Weekly blog drafter";

export type Readiness = { ready: true } | { ready: false; message: string };

/**
 * Whether a draft could be attempted at all, checked BEFORE the week is
 * claimed: a dormant key must not use up the week's attempts, or the week the
 * key is finally set would already be spent. runAi re-checks everything.
 */
export async function blogDraftingReady(): Promise<Readiness> {
  const r = await aiReadiness({ churchId: null, feature: "blog" });
  if ("ready" in r) return { ready: true };
  return { ready: false, message: `Automatic drafting is off: ${r.message}` };
}

/**
 * Claims this ISO week for the scheduled draft.
 *
 * INSERT ... ON CONFLICT (week) WHERE trigger = 'schedule' DO UPDATE ... WHERE
 * <failed with attempts left, or running and stale>. Postgres locks the
 * conflicting row, so of two concurrent ticks only one statement's WHERE can
 * match; the other returns no row. Every column in the raw SQL is written
 * fully qualified: inside DO UPDATE an unqualified name is ambiguous with
 * EXCLUDED, and drizzle drops the qualifier in a join-less query.
 *
 * Returns the run id, or null for "already done or in progress". `exec`
 * exists for blog-drafts.db-check.ts, which holds one claim open inside a
 * transaction while a second one runs.
 */
export type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function claimScheduledWeek(
  week: string,
  exec: DbOrTx = db,
): Promise<string | null> {
  const rows = await exec
    .insert(blogDraftRun)
    .values({ week, trigger: "schedule", status: "running" })
    .onConflictDoUpdate({
      target: blogDraftRun.week,
      targetWhere: sql`${blogDraftRun.trigger} = 'schedule'`,
      set: {
        attempts: sql`"blog_draft_run"."attempts" + 1`,
        status: "running",
        startedAt: sql`now()`,
        error: null,
        finishedAt: null,
      },
      setWhere: sql`("blog_draft_run"."status" = 'failed' and "blog_draft_run"."attempts" < ${MAX_SCHEDULED_ATTEMPTS}) or ("blog_draft_run"."status" = 'running' and "blog_draft_run"."started_at" < now() - interval '30 minutes')`,
    })
    .returning({ id: blogDraftRun.id });
  return rows.length === 1 ? rows[0].id : null;
}

/** "Draft one now": a manual run row outside the weekly index. */
export async function startManualRun(input: {
  userId: string;
  topicKey: string | null;
}): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const rl = rateLimit(`blog-draft:${input.userId}`, 3, 3_600_000);
  if (!rl.ok) {
    return {
      ok: false,
      error: `Three drafts an hour is the limit. Try again in ${Math.max(1, Math.ceil(rl.retryAfterSec / 60))} min.`,
    };
  }
  const [row] = await db
    .insert(blogDraftRun)
    .values({
      week: isoWeekKey(new Date()),
      trigger: "manual",
      status: "running",
      topicKey: input.topicKey,
      createdBy: input.userId,
    })
    .returning({ id: blogDraftRun.id });
  return { ok: true, runId: row.id };
}

/** Topics already drafted: by a run, or by a post that carries the key. */
export async function usedTopicKeys(): Promise<Set<string>> {
  const [runs, posts] = await Promise.all([
    db
      .selectDistinct({ key: blogDraftRun.topicKey })
      .from(blogDraftRun)
      .where(and(eq(blogDraftRun.status, "drafted"), isNotNull(blogDraftRun.topicKey))),
    db
      .selectDistinct({ key: blogPost.topicKey })
      .from(blogPost)
      .where(isNotNull(blogPost.topicKey)),
  ]);
  const out = new Set<string>();
  for (const r of [...runs, ...posts]) if (r.key) out.add(r.key);
  return out;
}

export type DraftOutcome =
  | { status: "drafted"; topic: string; postId: string }
  | { status: "skipped"; error: string }
  | { status: "failed"; topic: string | null; error: string };

async function finishRun(
  runId: string,
  patch: Partial<typeof blogDraftRun.$inferInsert>,
): Promise<void> {
  await db
    .update(blogDraftRun)
    .set({ ...patch, finishedAt: new Date() })
    .where(eq(blogDraftRun.id, runId));
}

type RunOpts = { topicKey?: string | null; userId?: string | null; userName?: string | null };

/**
 * Drafts one post for a claimed run. Every outcome is written to the run row
 * with the cause in words, so /superadmin/blog can say what happened.
 *
 * A throw (the database, the slug lookup, the audit write) is written to the
 * row too and then rethrown. Without that the row would sit at "running" for
 * half an hour and then read "interrupted", which names no cause at all.
 */
export async function executeDraftRun(runId: string, opts: RunOpts = {}): Promise<DraftOutcome> {
  try {
    return await draftOne(runId, opts);
  } catch (e) {
    const error = `The draft stopped on a server error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 2000);
    try {
      // Only a run still in flight: a throw after the post was saved (the
      // audit row, say) must not turn a real draft into a "failed" one.
      await db
        .update(blogDraftRun)
        .set({ status: "failed", error, finishedAt: new Date() })
        .where(and(eq(blogDraftRun.id, runId), eq(blogDraftRun.status, "running")));
    } catch (recordError) {
      console.error("[blog-drafts] could not record the failure on run", runId, recordError);
    }
    throw e;
  }
}

async function draftOne(runId: string, opts: RunOpts): Promise<DraftOutcome> {
  let topic: BlogTopic | null = findTopic(opts.topicKey);
  if (!topic) topic = nextTopic(await usedTopicKeys());
  if (!topic) {
    const error =
      "Every keyword-map topic has a post. Add terms to src/lib/seo/keywords.ts to give the drafter more to write about.";
    await finishRun(runId, { status: "skipped", error });
    return { status: "skipped", error };
  }
  await db.update(blogDraftRun).set({ topicKey: topic.key }).where(eq(blogDraftRun.id, runId));

  const prompt = buildBlogDraftPrompt(topic);
  const result = await runAi({
    churchId: null,
    feature: "blog",
    model: MODELS.sonnet,
    promptId: BLOG_PROMPT_ID,
    messages: [{ role: "user", content: scrubFreeText(prompt.user, 60_000) }],
    maxTokens: BLOG_MAX_TOKENS,
    actorUserId: opts.userId ?? null,
  });
  if (!result.ok) {
    // A truncated post is never saved: half an argument is worse than none.
    const error = `${result.message} (${result.reason})`;
    await finishRun(runId, { status: "failed", error, model: MODELS.sonnet });
    return { status: "failed", topic: topic.key, error };
  }

  const tokens = { input: result.usage.inputTokens, output: result.usage.outputTokens };
  const parsed = parseBlogDraft(result.text);
  if (!parsed.ok) {
    await finishRun(runId, {
      status: "failed",
      error: parsed.error,
      model: MODELS.sonnet,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
    });
    return { status: "failed", topic: topic.key, error: parsed.error };
  }
  const d = parsed.draft;

  const [post] = await db
    .insert(blogPost)
    .values({
      title: d.title,
      slug: await uniqueBlogSlug(d.title),
      excerpt: excerptFromBody(d.body),
      body: d.body,
      seoTitle: d.seoTitle,
      seoDescription: d.seoDescription,
      tags: d.tags,
      status: "draft",
      source: "ai",
      topicKey: topic.key,
      aiDraftedAt: new Date(),
      authorName: "The FlockInsight Team",
      createdBy: opts.userId ?? null,
    })
    .returning({ id: blogPost.id });

  await finishRun(runId, {
    status: "drafted",
    postId: post.id,
    model: MODELS.sonnet,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    error: null,
  });

  const entry = {
    action: "platform.blog.draft",
    summary: `Drafted a blog post for review: "${d.title}" (topic: ${topic.key})`,
    targetType: "blog_post",
    targetId: post.id,
    targetLabel: d.title,
  };
  if (opts.userId) {
    await recordAudit({ ...entry, actorUserId: opts.userId, actorName: opts.userName ?? null });
  } else {
    await auditSystem({ ...entry, actorName: DRAFTER_NAME });
  }
  revalidatePath("/superadmin/blog");
  return { status: "drafted", topic: topic.key, postId: post.id };
}

/** For the strip and the dialog: the latest run, how many topics are left, and what is next. */
export async function draftingOverview(): Promise<{
  used: Set<string>;
  remaining: number;
  next: BlogTopic | null;
}> {
  const used = await usedTopicKeys();
  return {
    used,
    remaining: BLOG_TOPICS.filter((t) => !used.has(t.key)).length,
    next: nextTopic(used),
  };
}
