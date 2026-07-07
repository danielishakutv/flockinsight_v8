import "server-only";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { blogPost, type BlogPost } from "@/db/schema";
import { slugify, randomSuffix } from "@/lib/slug";

const RESERVED_BLOG_SLUGS = new Set(["new", "edit", "admin", "api", "feed", "rss"]);

/** A globally-unique blog slug. */
export async function uniqueBlogSlug(
  base: string,
  excludeId?: string,
): Promise<string> {
  let slug = slugify(base) || "post";
  if (RESERVED_BLOG_SLUGS.has(slug)) slug = `${slug}-post`;
  for (let i = 0; i < 6; i++) {
    const [clash] = await db
      .select({ id: blogPost.id })
      .from(blogPost)
      .where(
        excludeId
          ? and(eq(blogPost.slug, slug), ne(blogPost.id, excludeId))
          : eq(blogPost.slug, slug),
      )
      .limit(1);
    if (!clash) return slug;
    slug = `${slugify(base) || "post"}-${randomSuffix(4)}`;
  }
  return `${slugify(base) || "post"}-${randomSuffix(6)}`;
}

export type PublicPostCard = {
  slug: string;
  title: string;
  excerpt: string | null;
  coverUrl: string | null;
  authorName: string;
  tags: string[];
  publishedAt: Date | null;
};

/** Published posts, newest first (for the public /blog index). */
export async function listPublishedPosts(limit = 100): Promise<PublicPostCard[]> {
  const rows = await db
    .select({
      slug: blogPost.slug,
      title: blogPost.title,
      excerpt: blogPost.excerpt,
      coverUrl: blogPost.coverUrl,
      authorName: blogPost.authorName,
      tags: blogPost.tags,
      publishedAt: blogPost.publishedAt,
    })
    .from(blogPost)
    .where(eq(blogPost.status, "published"))
    .orderBy(desc(blogPost.publishedAt))
    .limit(limit);
  return rows;
}

/** A single published post by slug (for /blog/[slug]). Null if not public. */
export async function getPublishedPost(slug: string): Promise<BlogPost | null> {
  const [row] = await db
    .select()
    .from(blogPost)
    .where(and(eq(blogPost.slug, slug), eq(blogPost.status, "published")))
    .limit(1);
  return row ?? null;
}

/** Slugs of all published posts (for the sitemap). */
export async function publishedSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
  return db
    .select({ slug: blogPost.slug, updatedAt: blogPost.updatedAt })
    .from(blogPost)
    .where(eq(blogPost.status, "published"))
    .orderBy(desc(blogPost.publishedAt));
}

/** Derive a short plain-text excerpt from a markdown body. */
export function excerptFromBody(body: string, max = 180): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max).trimEnd()}…` : plain;
}
