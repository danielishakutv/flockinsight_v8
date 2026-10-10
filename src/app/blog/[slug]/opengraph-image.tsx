import { getPublishedPost, excerptFromBody } from "@/lib/blog";
import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";

/**
 * A blog post's link preview: the headline, set as type.
 *
 * The post's own `coverUrl` is deliberately not used here, and that is a
 * decision rather than an oversight. Uploaded cover art is almost never 1.91:1
 * — it is whatever shape the image was — so every platform crops it
 * differently and the result is a headline cut in half. The cover still leads
 * the article; the preview carries the words, because the words are what make
 * somebody tap.
 *
 * `dynamic` is inherited from the page, which is force-dynamic so a post
 * published a minute ago previews correctly rather than after a revalidate.
 */
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Article on the FlockInsight blog";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPublishedPost(slug);

  if (!post) {
    return ogCard({
      eyebrow: "FlockInsight blog",
      title: "Writing for church leaders",
      subtitle: "Practical notes on running a church well.",
    });
  }

  return ogCard({
    eyebrow: "FlockInsight blog",
    title: post.title,
    subtitle:
      post.seoDescription || post.excerpt || excerptFromBody(post.body),
  });
}
