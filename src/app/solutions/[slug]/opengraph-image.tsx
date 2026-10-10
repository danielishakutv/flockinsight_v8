import { findSolution, solutionContent } from "@/lib/seo/pages";
import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";

/** A solution page's link preview: the job, and the headline that answers it. */
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Church software, by job";
export const revalidate = 86_400;

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const term = findSolution(slug);
  const content = term ? solutionContent(term) : undefined;

  if (!term || !content) {
    return ogCard({
      eyebrow: "Solutions",
      title: "What do you need it to do?",
      subtitle: "Count the congregation, keep the list current, chase first-timers, keep the books.",
    });
  }

  return ogCard({
    eyebrow: term.primary.charAt(0).toUpperCase() + term.primary.slice(1),
    title: content.h1,
    // The page's own first sentence, so the card and the page agree.
    subtitle: `${content.summary.split(". ")[0]}.`,
    chips: ["7 Sundays free", "No card", "Full export"],
  });
}
