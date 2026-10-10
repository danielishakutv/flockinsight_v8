import { getPublicLinkPage } from "@/lib/link-pages";
import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";

/**
 * A church's link page preview.
 *
 * This URL lives in an Instagram or WhatsApp bio, which is exactly where a
 * correct preview earns the most: the card is the only thing a stranger sees
 * before deciding whether the church is a real organisation or a dead link.
 *
 * The chips are the first three things the church actually put on the page, so
 * the preview advertises the real contents rather than a generic line. If the
 * page is empty, there are no chips — there is nothing to promise.
 */
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "A church's links on FlockInsight";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await getPublicLinkPage(slug);

  if (!page) {
    return ogCard({
      title: "This page is not available",
      subtitle: "The link may have been unpublished by the church that created it.",
    });
  }

  return ogCard({
    variant: "church",
    eyebrow: page.churchName,
    title: page.title,
    subtitle:
      page.tagline?.replace(/\s+/g, " ").trim().slice(0, 150) ||
      `Everything from ${page.churchName}, in one place.`,
    chips: page.items.slice(0, 3).map((i) => i.label),
  });
}
