import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { listPublishedPosts } from "@/lib/blog";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Insights, tips and stories to help your church grow — from the FlockInsight team.",
  alternates: { canonical: `${siteUrl()}/blog` },
  openGraph: {
    title: "FlockInsight Blog",
    description:
      "Insights, tips and stories to help your church grow — from the FlockInsight team.",
    url: `${siteUrl()}/blog`,
    type: "website",
  },
};

export default async function BlogIndexPage() {
  const posts = await listPublishedPosts();

  return (
    <div className="min-h-dvh">
      <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Link href="/">
            <Wordmark logoClassName="size-8" className="text-lg" />
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground hidden items-center gap-1 text-sm font-medium sm:inline-flex"
            >
              <ArrowLeft className="size-4" /> Home
            </Link>
            <Button asChild size="sm">
              <Link href="/signup">Get started free</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 lg:py-16">
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-5xl">
          The FlockInsight Blog
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-lg">
          Insights, tips and stories to help your church grow.
        </p>

        {posts.length === 0 ? (
          <p className="text-muted-foreground mt-16">No posts yet — check back soon.</p>
        ) : (
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((p) => (
              <Link
                key={p.slug}
                href={`/blog/${p.slug}`}
                className="group bg-card hover:border-primary/40 flex flex-col overflow-hidden rounded-2xl border shadow-sm transition-colors"
              >
                {p.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.coverUrl}
                    alt=""
                    className="aspect-[16/9] w-full object-cover"
                  />
                ) : (
                  <div className="from-primary/20 aspect-[16/9] w-full bg-gradient-to-br to-transparent" />
                )}
                <div className="flex flex-1 flex-col p-5">
                  {p.tags.length > 0 && (
                    <span className="text-primary mb-2 text-xs font-bold uppercase tracking-wide">
                      {p.tags[0]}
                    </span>
                  )}
                  <h2 className="group-hover:text-primary text-lg font-extrabold leading-snug tracking-tight transition-colors">
                    {p.title}
                  </h2>
                  {p.excerpt && (
                    <p className="text-muted-foreground mt-2 line-clamp-3 text-sm">
                      {p.excerpt}
                    </p>
                  )}
                  <p className="text-muted-foreground mt-4 text-xs">
                    {p.authorName}
                    {p.publishedAt
                      ? ` · ${format(p.publishedAt, "MMM d, yyyy")}`
                      : ""}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
