import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { countLinkPageView, getPublicLinkPage } from "@/lib/link-pages";
import { LinkPageView } from "@/components/links/link-page-view";

/**
 * `/hub/<slug>` — the link in the bio.
 *
 * `getPublicLinkPage` returns null for an unknown slug, for a draft, and for a
 * suspended church, so all three land on the same 404. That is deliberate and
 * it is the same reasoning as the welcome link: a different answer for each
 * would turn this address into a way of discovering which churches are on the
 * platform, and of confirming the address of a page a church has not published
 * yet.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublicLinkPage(slug);
  if (!page) return { title: "Page not found" };

  const description =
    page.tagline ??
    `Links from ${page.churchName}${
      page.items.length ? ` — ${page.items.map((i) => i.label).join(", ")}` : ""
    }`;

  return {
    title: `${page.title} · ${page.churchName}`,
    description: description.slice(0, 300),
    /*
     * Indexed, unlike the welcome card.
     *
     * This one is meant to be found: a church puts it in a bio and reads it
     * from the front, and it holds only things the church has already
     * published. The welcome card is the opposite — a form handed to somebody
     * in a building, which an indexed page would fill with strangers.
     */
    openGraph: {
      title: `${page.title} · ${page.churchName}`,
      description: description.slice(0, 300),
      // Card comes from `opengraph-image.tsx` here.
      type: "website",
    },
  };
}

export default async function HubPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await getPublicLinkPage(slug);
  if (!page) notFound();

  /*
   * Counted, but never waited for.
   *
   * `void` rather than `await`: a slow write must not be the reason somebody's
   * bio link is slow to open, and the count is the least important thing on
   * the page. `countLinkPageView` swallows its own errors for the same reason
   * and says so.
   */
  void countLinkPageView(slug);

  return (
    <LinkPageView
      title={page.title}
      tagline={page.tagline}
      styleId={page.style}
      layoutId={page.layout}
      showLogo={page.showLogo}
      showChurchName={page.showChurchName}
      churchName={page.churchName}
      churchLogo={page.churchLogo}
      churchTheme={page.churchTheme}
      items={page.items}
    />
  );
}
