import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicContribution } from "@/lib/contributions";
import { formatMoney } from "@/lib/money";
import { PublicContributionPage } from "@/components/contributions/public-contribution";

/*
 * Never statically rendered. The figure at the top is the entire point, and a
 * cached page would hand somebody a total from whenever it was last built.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const pot = await getPublicContribution(slug);
  if (!pot) return { title: "Not found" };

  /*
   * The description is the WhatsApp preview, and it is written for that.
   *
   * This link's whole life is in group chats, where the preview card is what
   * decides whether anyone taps it. Leading with the figure is the difference
   * between "someone shared a link" and "we are at 145,000 of 200,000".
   */
  const figure = pot.target
    ? `${formatMoney(pot.raised, pot.currency)} of ${formatMoney(pot.target, pot.currency)}`
    : formatMoney(pot.raised, pot.currency);
  const description = `${figure} from ${pot.givers} ${pot.givers === 1 ? "person" : "people"}. ${pot.purpose ?? `A collection by ${pot.churchName}.`}`.slice(
    0,
    300,
  );

  return {
    title: `${pot.title} — ${pot.churchName}`,
    description,
    openGraph: {
      title: pot.title,
      description,
      type: "website",
      images: pot.churchLogo ? [{ url: pot.churchLogo }] : undefined,
    },
    /*
     * Not indexed. A collection's page names who gave what inside one
     * department; it is meant for the people the link was sent to, not for
     * search results. The link is unguessable, and this keeps it out of the
     * places unguessable links leak from.
     */
    robots: { index: false, follow: false },
  };
}

export default async function PublicPotPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pot = await getPublicContribution(slug);

  // A draft, a private collection and a slug that never existed are all the same
  // answer. Distinguishing them would confirm that a private link is real.
  if (!pot) notFound();

  // Every string on the page comes from the dictionary, through `useT()` in
  // the component — the provider lives in the root layout, so somebody opening
  // this link reads it in their own language without the page passing labels in.
  return <PublicContributionPage initial={pot} />;
}
