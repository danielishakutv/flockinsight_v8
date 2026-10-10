import { compareContent, findComparison } from "@/lib/seo/pages";
import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";

/**
 * A comparison page's link preview.
 *
 * "Including where we lose" is on the card deliberately. It is the line that
 * makes somebody open a comparison page written by one of the two products,
 * and it is the line that makes the preview worth forwarding.
 */
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "An honest church software comparison";
export const revalidate = 86_400;

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const term = findComparison(slug);
  const content = term ? compareContent(term) : undefined;

  if (!term || !content) {
    return ogCard({
      eyebrow: "Compare",
      title: "Honest comparisons, including where we lose",
      subtitle: "Every product we compare ourselves to is better than us at something. Each page says what.",
    });
  }

  return ogCard({
    eyebrow: `vs ${term.competitor}`,
    title: content.h1,
    subtitle: `${content.summary.split(". ")[0]}.`,
    chips: ["Where they win too", "No feature-matrix spin"],
  });
}
