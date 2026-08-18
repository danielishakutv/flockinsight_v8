import { desc } from "drizzle-orm";
import { db } from "@/db";
import { blogPost } from "@/db/schema";
import { siteUrl } from "@/lib/site";
import { BlogList } from "@/components/superadmin/blog-list";

export const metadata = { title: "Blog · Admin" };

export default async function SuperadminBlogPage() {
  const rows = await db
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
    })
    .from(blogPost)
    .orderBy(desc(blogPost.updatedAt))
    .limit(200);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Blog</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Write and publish articles on the FlockInsight website for SEO &amp;
          sharing.
        </p>
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
        }))}
      />
    </div>
  );
}
