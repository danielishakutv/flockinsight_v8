import { getPublicGivingLink } from "@/lib/online-giving";
import { formatMoney } from "@/lib/money";
import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";

/**
 * A giving link's preview.
 *
 * Shared in the same places as a collection — a group chat, a bio, a projector
 * slide — and with the same problem before this file: a square church logo and
 * therefore the small preview bubble.
 *
 * The amount raised appears only when the church chose to show progress.
 * `showProgress` is a setting somebody set deliberately, and a preview card is
 * a more public surface than the page itself, so it is the one place that flag
 * must not be second-guessed. Read what was declared; never infer it from the
 * fact that a figure happens to be non-zero.
 */
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Give to a church on FlockInsight";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const link = await getPublicGivingLink(slug);

  if (!link) {
    return ogCard({
      title: "This giving link is not available",
      subtitle: "The church may have closed it.",
    });
  }

  const chips = [
    link.showProgress && link.raised > 0
      ? `${formatMoney(link.raised, link.currency)} given`
      : "",
    "Card, transfer or USSD",
    "Instant receipt",
  ].filter(Boolean);

  return ogCard({
    variant: "church",
    eyebrow: link.churchName,
    title: link.title,
    subtitle:
      link.description?.replace(/\s+/g, " ").trim().slice(0, 150) ||
      `Give to ${link.churchName} securely from your phone.`,
    chips,
  });
}
