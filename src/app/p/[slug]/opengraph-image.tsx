import { getPublicContribution } from "@/lib/contributions";
import { formatMoney } from "@/lib/money";
import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";

/**
 * A group collection's link preview — the figure, as large as it will go.
 *
 * This link's entire life is in a WhatsApp group, and the page's own
 * `generateMetadata` already makes the point: leading with the figure is the
 * difference between "someone shared a link" and "we are at ₦145,000 of
 * ₦200,000". The description said that; the image said nothing, because a
 * church logo is square and WhatsApp answers a square image with the small
 * thumbnail bubble. So the sentence that was written for the preview was being
 * rendered in the preview's smallest possible form.
 *
 * Note the ₦. This card can only draw it because `ogCard` embeds Noto Sans —
 * the built-in face would put a box there, the same way every PDF in the
 * platform printed `¦3,659,040.00` for months.
 *
 * The page is `noindex`, and so, by inheritance, is this image. It is for the
 * people the link was sent to.
 */
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "A church collection on FlockInsight";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pot = await getPublicContribution(slug);

  if (!pot) {
    return ogCard({
      title: "This collection is not available",
      subtitle: "The link may have been closed by the church that created it.",
    });
  }

  const raised = formatMoney(pot.raised, pot.currency);
  const figure = pot.target
    ? `${raised} of ${formatMoney(pot.target, pot.currency)}`
    : raised;

  return ogCard({
    variant: "church",
    eyebrow: pot.churchName,
    title: pot.title,
    subtitle: pot.purpose?.replace(/\s+/g, " ").trim().slice(0, 150) || undefined,
    chips: [
      figure,
      `${pot.givers} ${pot.givers === 1 ? "person" : "people"}`,
      "Give from your phone",
    ],
  });
}
