import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { blogPost } from "@/db/schema";
import { getPublishedPost, excerptFromBody } from "@/lib/blog";
import { siteUrl } from "@/lib/site";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { JsonLd } from "@/components/seo/json-ld";
import { Markdown } from "@/components/blog/markdown";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post) return { title: "Post not found" };
  const description =
    post.seoDescription || post.excerpt || excerptFromBody(post.body);
  const url = `${siteUrl()}/blog/${post.slug}`;
  return {
    title: post.seoTitle || post.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: post.seoTitle || post.title,
      description,
      url,
      type: "article",
      publishedTime: post.publishedAt?.toISOString(),
      // Card comes from `opengraph-image.tsx` here: the headline as type,
      // which is never cropped. Cover art still leads the article.
    },
    twitter: {
      // Always the large card now, because there is always a large image.
      // This used to fall back to "summary" for a post with no cover, which
      // is the narrow thumbnail nobody taps.
      card: "summary_large_image",
      title: post.seoTitle || post.title,
      description,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post) notFound();

  /*
   * View counter. Handed to `after()` rather than left as a floating promise:
   * an un-awaited query during render has no owner, so the runtime is free to
   * tear the request down before it lands and the count quietly stops moving.
   * `after()` runs it once the response is sent, which is the same "never
   * blocks the render" intent with somebody actually holding it.
   */
  after(async () => {
    try {
      await db
        .update(blogPost)
        .set({ views: sql`${blogPost.views} + 1` })
        .where(sql`${blogPost.id} = ${post.id}`);
    } catch (e) {
      console.error(`blog: view count failed for ${post.slug}`, e);
    }
  });

  const url = `${siteUrl()}/blog/${post.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.seoDescription || post.excerpt || excerptFromBody(post.body),
    image: post.coverUrl || undefined,
    author: { "@type": "Organization", name: post.authorName },
    publisher: {
      "@type": "Organization",
      name: "FlockInsight",
      url: siteUrl(),
    },
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    mainEntityOfPage: url,
  };

  return (
    <div className="min-h-dvh">
      <JsonLd data={jsonLd} />
      <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Link href="/">
            <Wordmark logoClassName="size-8" className="text-lg" />
          </Link>
          <Link
            href="/blog"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
          >
            <ArrowLeft className="size-4" /> All posts
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 lg:py-14">
        <article>
          {post.tags.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {post.tags.map((t) => (
                <span
                  key={t}
                  className="bg-primary/10 text-primary rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
            {post.title}
          </h1>
          <p className="text-muted-foreground mt-3 text-sm">
            {post.authorName}
            {post.publishedAt ? ` · ${format(post.publishedAt, "MMMM d, yyyy")}` : ""}
          </p>

          {post.coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.coverUrl}
              alt=""
              className="mt-6 aspect-[16/9] w-full rounded-2xl border object-cover"
            />
          )}

          <div className="mt-8">
            <Markdown>{post.body}</Markdown>
          </div>
        </article>

        {/* CTA */}
        <div className="border-primary/30 from-primary/5 mt-14 rounded-2xl border bg-gradient-to-br to-transparent p-8 text-center">
          <h2 className="text-2xl font-extrabold tracking-tight">
            Run your church with confidence
          </h2>
          <p className="text-muted-foreground mx-auto mt-2 max-w-md">
            FlockInsight helps you track attendance, members, giving and more —
            with your first 7 Sundays free.
          </p>
          <Button asChild size="lg" className="mt-5">
            <Link href="/signup">Get started free</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
