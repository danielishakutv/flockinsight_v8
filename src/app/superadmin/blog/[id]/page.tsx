import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { blogPost } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { siteUrl } from "@/lib/site";
import { BlogEditor } from "@/components/superadmin/blog-editor";

export const metadata = { title: "Edit post · Admin" };

export default async function BlogEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSuperAdmin();
  const { id } = await params;

  const [post] = await db
    .select()
    .from(blogPost)
    .where(eq(blogPost.id, id))
    .limit(1);
  if (!post) notFound();

  return (
    <BlogEditor
      baseUrl={siteUrl()}
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
