"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { blogDraftRun, blogPost } from "@/db/schema";

import { uniqueBlogSlug, excerptFromBody } from "@/lib/blog";
import { deliverBroadcast } from "@/lib/broadcasts";
import { recordAudit } from "@/lib/audit";

import { requirePlatform } from "@/lib/platform-access";
import { draftFlags, publishRefusal } from "@/lib/blog-draft-checks";
import { BLOG_TOPICS, findTopic } from "@/lib/seo/blog-topics";
import {
  STALE_RUN_MINUTES,
  blogDraftingReady,
  executeDraftRun,
  startManualRun,
} from "@/lib/blog-drafts";
export type ActionResult = { ok: true } | { ok: false; error: string };

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const schema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1, "Add a title").max(200),
  slug: z.string().trim().min(1).max(80),
  excerpt: z.preprocess(emptyToNull, z.string().trim().max(400).nullable()),
  body: z.string().max(50_000),
  coverUrl: z.preprocess(emptyToNull, z.string().trim().max(500).nullable()),
  authorName: z.string().trim().min(1).max(120),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  seoTitle: z.preprocess(emptyToNull, z.string().trim().max(200).nullable()),
  seoDescription: z.preprocess(emptyToNull, z.string().trim().max(400).nullable()),
  status: z.enum(["draft", "published"]),
  // Sent by the editor's publish dialog for an AI draft ("I've read this post
  // in full and checked every claim"). The server enforces the rule too.
  confirmReviewed: z.boolean().optional(),
});

export type BlogPostInput = z.input<typeof schema>;

/** Create a blank draft and return its id (opened in the editor). */
export async function createPost(): Promise<
  { ok: true; id: string } | { ok: false; error: string }
> {
  const user = await requirePlatform("platform.content.manage");
  const slug = await uniqueBlogSlug("untitled-post");
  // Default the byline to the signed-in admin's name (fallback: Daniel Ishaku).
  const authorName = user.name?.trim() || "Daniel Ishaku";
  const [row] = await db
    .insert(blogPost)
    .values({
      title: "Untitled post",
      slug,
      body: "",
      authorName,
      createdBy: user.id,
    })
    .returning({ id: blogPost.id });
  revalidatePath("/superadmin/blog");
  return { ok: true, id: row.id };
}

export async function savePost(input: BlogPostInput): Promise<ActionResult> {
  const admin = await requirePlatform("platform.content.manage");
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const [current] = await db
    .select({
      publishedAt: blogPost.publishedAt,
      source: blogPost.source,
      reviewedAt: blogPost.reviewedAt,
      topicKey: blogPost.topicKey,
    })
    .from(blogPost)
    .where(eq(blogPost.id, d.id))
    .limit(1);
  if (!current) return { ok: false, error: "Post not found." };

  /*
   * An AI draft is never published unread, and never with a forbidden claim
   * in it. Human posts are unchanged. The editor asks for the same
   * confirmation; this is the rule, the dialog is only the reminder.
   */
  const firstAiPublish =
    d.status === "published" && current.source === "ai" && !current.reviewedAt;
  if (d.status === "published") {
    const refusal = publishRefusal({
      source: current.source,
      reviewedAt: current.reviewedAt,
      confirmReviewed: d.confirmReviewed,
      flags: draftFlags({ title: d.title, body: d.body }, findTopic(current.topicKey)),
    });
    if (refusal) return { ok: false, error: refusal };
  }

  const slug = await uniqueBlogSlug(d.slug || d.title, d.id);
  // Stamp publishedAt the first time a post goes live.
  const publishedAt =
    d.status === "published"
      ? (current.publishedAt ?? new Date())
      : current.publishedAt;

  await db
    .update(blogPost)
    .set({
      title: d.title,
      slug,
      excerpt: d.excerpt ?? excerptFromBody(d.body),
      body: d.body,
      coverUrl: d.coverUrl,
      authorName: d.authorName,
      tags: d.tags,
      seoTitle: d.seoTitle,
      seoDescription: d.seoDescription,
      status: d.status,
      publishedAt,
      ...(firstAiPublish ? { reviewedBy: admin.id, reviewedAt: new Date() } : {}),
    })
    .where(eq(blogPost.id, d.id));

  if (firstAiPublish) {
    await recordAudit({
      actorUserId: admin.id,
      actorName: admin.name,
      action: "platform.blog.publish",
      summary: `Read and published the AI-drafted post "${d.title}"`,
      targetType: "blog_post",
      targetId: d.id,
      targetLabel: d.title,
    });
  }

  revalidatePath("/superadmin/blog");
  revalidatePath(`/superadmin/blog/${d.id}`);
  revalidatePath("/blog");
  revalidatePath(`/blog/${slug}`);
  return { ok: true };
}

export async function setPostStatus(
  id: string,
  status: "draft" | "published",
): Promise<ActionResult> {
  await requirePlatform("platform.content.manage");
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };

  const [current] = await db
    .select({
      publishedAt: blogPost.publishedAt,
      source: blogPost.source,
      reviewedAt: blogPost.reviewedAt,
    })
    .from(blogPost)
    .where(eq(blogPost.id, id))
    .limit(1);
  if (!current) return { ok: false, error: "Post not found." };
  // One click from the list must never publish an AI draft nobody has read.
  if (status === "published" && current.source === "ai" && !current.reviewedAt) {
    return { ok: false, error: "Open this draft in the editor and read it before publishing." };
  }

  await db
    .update(blogPost)
    .set({
      status,
      publishedAt:
        status === "published" ? (current.publishedAt ?? new Date()) : current.publishedAt,
    })
    .where(eq(blogPost.id, id));

  revalidatePath("/superadmin/blog");
  revalidatePath("/blog");
  return { ok: true };
}

export async function deletePost(id: string): Promise<ActionResult> {
  await requirePlatform("platform.content.manage");
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  await db.delete(blogPost).where(eq(blogPost.id, id));
  revalidatePath("/superadmin/blog");
  revalidatePath("/blog");
  return { ok: true };
}

const announceSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1, "Add a headline").max(120),
  body: z.string().trim().min(1, "Add a short message").max(2000),
  inApp: z.boolean(),
  email: z.boolean(),
});

export type AnnounceResult =
  | { ok: true; pushSent: number; emailSent: number; inApp: boolean; email: boolean }
  | { ok: false; error: string };

/**
 * "Push to all": announce a published post to every church on the platform via
 * an in-app notification (+ web push) and/or email. Reuses the same broadcast
 * pipeline as the superadmin notifications composer.
 */
export async function announcePost(
  input: z.input<typeof announceSchema>,
): Promise<AnnounceResult> {
  const admin = await requirePlatform("platform.content.manage");
  const parsed = announceSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;
  if (!d.inApp && !d.email)
    return { ok: false, error: "Pick at least one channel (in-app or email)." };

  const [post] = await db
    .select({
      id: blogPost.id,
      slug: blogPost.slug,
      title: blogPost.title,
      status: blogPost.status,
    })
    .from(blogPost)
    .where(eq(blogPost.id, d.id))
    .limit(1);
  if (!post) return { ok: false, error: "Post not found." };
  if (post.status !== "published")
    return { ok: false, error: "Publish the post before announcing it." };

  const { pushSent, emailSent } = await deliverBroadcast({
    title: d.title,
    body: d.body,
    category: "general",
    audience: "all",
    linkUrl: `/blog/${post.slug}`,
    inApp: d.inApp,
    email: d.email,
    createdBy: admin.id,
  });

  await db
    .update(blogPost)
    .set({ announcedAt: new Date() })
    .where(eq(blogPost.id, post.id));

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "announce_blog_post",
    summary: `Announced blog post "${post.title}" to all · ${emailSent} emails, ${pushSent} push`,
    targetType: "blog_post",
    targetId: post.id,
  });

  revalidatePath("/superadmin/blog");
  revalidatePath(`/superadmin/blog/${post.id}`);
  return { ok: true, pushSent, emailSent, inApp: d.inApp, email: d.email };
}

/* ============================================================
 * AI drafts: "Draft one now"
 * ========================================================== */

export type DraftNowResult = { ok: true; runId: string } | { ok: false; error: string };

/**
 * Starts a draft and returns at once with the run id; the dialog polls
 * getDraftRun. A Sonnet draft takes tens of seconds and sometimes minutes,
 * and a server action held open that long through Cloudflare comes back as a
 * 524 while the draft lands anyway. So the work happens in after(), and the
 * run row is the record of how it went.
 */
export async function draftPostNow(input: { topicKey?: string | null }): Promise<DraftNowResult> {
  const admin = await requirePlatform("platform.content.manage");
  const topicKey = (input.topicKey ?? "").trim() || null;
  if (topicKey && !BLOG_TOPICS.some((t) => t.key === topicKey)) {
    return { ok: false, error: "That topic is no longer in the keyword map. Pick another." };
  }
  const ready = await blogDraftingReady();
  if (!ready.ready) return { ok: false, error: ready.message };

  const run = await startManualRun({ userId: admin.id, topicKey });
  if (!run.ok) return run;

  const runId = run.runId;
  after(() =>
    executeDraftRun(runId, { topicKey, userId: admin.id, userName: admin.name })
      .then(() => undefined)
      .catch((e) => {
        // executeDraftRun has already written the cause to the run row, which
        // the dialog shows; this line keeps the stack for the logs.
        console.error("[blog-drafts] manual run", runId, e);
      }),
  );
  revalidatePath("/superadmin/blog");
  return { ok: true, runId };
}

export type DraftRunView = {
  status: "running" | "drafted" | "failed" | "skipped" | "interrupted";
  postId: string | null;
  error: string | null;
  startedAt: string;
};

export async function getDraftRun(input: {
  runId: string;
}): Promise<{ ok: true; run: DraftRunView } | { ok: false; error: string }> {
  await requirePlatform("platform.content.manage");
  if (!z.string().uuid().safeParse(input.runId).success) {
    return { ok: false, error: "That draft run does not exist." };
  }
  const [row] = await db
    .select({
      status: blogDraftRun.status,
      postId: blogDraftRun.postId,
      error: blogDraftRun.error,
      startedAt: blogDraftRun.startedAt,
    })
    .from(blogDraftRun)
    .where(eq(blogDraftRun.id, input.runId))
    .limit(1);
  if (!row) return { ok: false, error: "That draft run does not exist." };
  const stale =
    row.status === "running" &&
    Date.now() - row.startedAt.getTime() > STALE_RUN_MINUTES * 60_000;
  return {
    ok: true,
    run: {
      status: stale ? "interrupted" : (row.status as DraftRunView["status"]),
      postId: row.postId,
      error: row.error,
      startedAt: row.startedAt.toISOString(),
    },
  };
}
