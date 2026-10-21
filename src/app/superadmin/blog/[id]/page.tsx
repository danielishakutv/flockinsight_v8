import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { blogPost } from "@/db/schema";

import { siteUrl } from "@/lib/site";
import { BlogEditor } from "@/components/superadmin/blog-editor";
import { findTopic } from "@/lib/seo/blog-topics";

import { requirePlatform } from "@/lib/platform-access";
export const metadata = { title: "Edit post · Admin" };

export default async function BlogEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatform("platform.content.manage");
  const { id } = await params;
  // A malformed id is "not found", not a server error — Postgres rejects the
  // uuid cast outright.
  if (!z.string().uuid().safeParse(id).success) notFound();

  const [post] = await db
    .select()
    .from(blogPost)
    .where(eq(blogPost.id, id))
    .limit(1);
  if (!post) notFound();
  const topic = findTopic(post.topicKey);

  return (
    <BlogEditor
      baseUrl={siteUrl()}
      review={
        post.source === "ai"
          ? {
              aiDraftedAt: post.aiDraftedAt ? post.aiDraftedAt.toISOString() : null,
              reviewedAt: post.reviewedAt ? post.reviewedAt.toISOString() : null,
              topic: topic
                ? {
                    question: topic.question,
                    primary: topic.primary,
                    canonicalPath: topic.canonicalPath,
                  }
                : null,
            }
          : null
      }
      post={{
        id: post.id,
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt ?? "",
        body: post.body,
        coverUrl: post.coverUrl ?? "",
        authorName: post.authorName,
        tags: post.tags,
        seoTitle: post.seoTitle ?? "",
        seoDescription: post.seoDescription ?? "",
        status: post.status,
        announcedAt: post.announcedAt ? post.announcedAt.toISOString() : null,
      }}
    />
  );
}
