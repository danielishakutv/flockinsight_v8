import { desc } from "drizzle-orm";
import { db } from "@/db";
import { blogDraftRun, blogPost } from "@/db/schema";
import { siteUrl } from "@/lib/site";
import { BlogList } from "@/components/superadmin/blog-list";
import { BlogDraftNow } from "@/components/superadmin/blog-draft-now";
import { BLOG_TOPICS } from "@/lib/seo/blog-topics";
import { STALE_RUN_MINUTES, blogDraftingReady, draftingOverview } from "@/lib/blog-drafts";

import { requirePlatform } from "@/lib/platform-access";
export const metadata = { title: "Blog · Admin" };

function runLabel(run: { status: string; startedAt: Date; error: string | null }): string {
  if (run.status === "running") {
    return Date.now() - run.startedAt.getTime() > STALE_RUN_MINUTES * 60_000
      ? "interrupted — try again"
      : "writing now";
  }
  if (run.status === "drafted") return "drafted";
  return run.error ? `${run.status}: ${run.error}` : run.status;
}

export default async function SuperadminBlogPage() {
  await requirePlatform("platform.content.manage");
  const [rows, [lastRun], overview, ready] = await Promise.all([
    db
      .select({
        id: blogPost.id,
        title: blogPost.title,
        slug: blogPost.slug,
        status: blogPost.status,
        authorName: blogPost.authorName,
        views: blogPost.views,
        publishedAt: blogPost.publishedAt,
        announcedAt: blogPost.announcedAt,
        updatedAt: blogPost.updatedAt,
        source: blogPost.source,
        topicKey: blogPost.topicKey,
      })
      .from(blogPost)
      .orderBy(desc(blogPost.updatedAt))
      .limit(200),
    db
      .select({
        status: blogDraftRun.status,
        startedAt: blogDraftRun.startedAt,
        error: blogDraftRun.error,
        trigger: blogDraftRun.trigger,
      })
      .from(blogDraftRun)
      .orderBy(desc(blogDraftRun.startedAt))
      .limit(1),
    draftingOverview(),
    blogDraftingReady(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Blog</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Write and publish articles on the FlockInsight website for SEO &amp;
          sharing.
        </p>
      </div>

      {/* The weekly drafter, in one line that wraps on a phone. The editor keeps
          working whatever this says. */}
      <div className="bg-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border p-3 text-sm shadow-sm">
        <div className="min-w-0 flex-1 space-y-0.5">
          {ready.ready ? (
            <p>
              {overview.next ? (
                <>
                  Next topic: <span className="font-medium">&lsquo;{overview.next.question}&rsquo;</span>
                </>
              ) : (
                "Every keyword-map topic has a post."
              )}{" "}
              · a draft every Monday 05:00 UTC · {overview.remaining} of {BLOG_TOPICS.length} topics
              left
            </p>
          ) : (
            <p className="text-amber-700 dark:text-amber-300">{ready.message}</p>
          )}
          {lastRun && (
            <p className="text-muted-foreground text-xs break-words">
              Last run {lastRun.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC (
              {lastRun.trigger}): {runLabel(lastRun)}
            </p>
          )}
        </div>
        <BlogDraftNow
          disabledReason={ready.ready ? null : ready.message}
          nextKey={overview.next?.key ?? null}
          topics={BLOG_TOPICS.map((t) => ({
            key: t.key,
            question: t.question,
            used: overview.used.has(t.key),
          }))}
        />
      </div>

      <BlogList
        baseUrl={siteUrl()}
        posts={rows.map((r) => ({
          id: r.id,
          title: r.title,
          slug: r.slug,
          status: r.status,
          authorName: r.authorName,
          views: r.views,
          publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
          announcedAt: r.announcedAt ? r.announcedAt.toISOString() : null,
          updatedAt: r.updatedAt.toISOString(),
          source: r.source === "ai" ? "ai" : "human",
        }))}
      />
    </div>
  );
}
