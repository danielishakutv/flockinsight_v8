import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicGivingLink } from "@/lib/online-giving";
import { formatMoney } from "@/lib/money";
import { GivePage } from "@/components/giving/give-page";
import { Toaster } from "@/components/ui/sonner";

/*
 * Never statically rendered. Whether the collection is open, whether the church
 * still has a working gateway and how much has come in are all facts about
 * right now, and a cached page would take a gift into an account that stopped
 * working last week.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const link = await getPublicGivingLink(slug);
  if (!link) return { title: "Not found" };

  const description = link.description
    ? link.description.slice(0, 200)
    : `Give to ${link.churchName} securely from your phone.`;

  return {
    title: `${link.title} — ${link.churchName}`,
    description,
    openGraph: {
      title: `${link.title} — ${link.churchName}`,
      description:
        link.showProgress && link.raised > 0
          ? `${formatMoney(link.raised, link.currency)} given so far. ${description}`
          : description,
      type: "website",
      // Card comes from `opengraph-image.tsx` here.
    },
    /*
     * Indexed, unlike a group contribution page.
     *
     * This one is meant to be findable: a church wants "give to <church name>"
     * to lead somewhere, and the page names no individual giver.
     */
    robots: { index: true, follow: true },
  };
}

export default async function PublicGivePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const link = await getPublicGivingLink(slug);
  if (!link) notFound();

  return (
    <>
      <GivePage link={link} />
      <Toaster />
    </>
  );
}
