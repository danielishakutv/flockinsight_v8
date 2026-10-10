import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";

/**
 * A church's own link preview.
 *
 * This is the card that matters most for how the platform spreads: a church
 * pastes flockinsight.com/c/their-handle into a WhatsApp group and three
 * hundred members see it. Before this file, the preview used `coverUrl ||
 * logo` — and a logo is square. WhatsApp given a square image draws the small
 * thumbnail preview, not the wide card, so the most-shared link on the
 * platform looked like the least important thing in the conversation.
 *
 * A generated 1.91:1 card fixes the shape and carries the church's name as
 * type, which stays legible at the size a chat list actually renders it. The
 * cover photo still leads the page itself; it was never a good 1200×630 crop.
 *
 * The card is the church's, not ours: `variant: "church"` drops FlockInsight
 * to one line of attribution in the corner. A maker's name across somebody
 * else's church preview reads as something gone wrong.
 */
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Church page on FlockInsight";

/*
 * Matches the page's own revalidate. The name, city and tagline on this card
 * change about never, and a crawler re-fetches the image every time a member
 * forwards the link.
 */
export const revalidate = 3600;

export default async function Image({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const [c] = await db
    .select({
      name: church.name,
      tagline: church.tagline,
      about: church.about,
      city: church.city,
      state: church.state,
      country: church.country,
    })
    .from(church)
    .where(and(eq(church.handle, handle), eq(church.publicEnabled, true)))
    .limit(1);

  /*
   * An unknown or private handle still gets a card rather than a 404 image.
   * A broken image in a WhatsApp bubble is worse than a generic one, and the
   * page itself already returns a proper not-found.
   */
  if (!c) {
    return ogCard({
      title: "Find a church near you",
      subtitle: "Churches on FlockInsight publish their service times and events.",
      eyebrow: "Church directory",
    });
  }

  const place = [c.city, c.state, c.country].filter(Boolean).join(", ");

  return ogCard({
    variant: "church",
    eyebrow: place || undefined,
    title: c.name,
    subtitle:
      c.tagline ||
      c.about?.replace(/\s+/g, " ").trim().slice(0, 150) ||
      "Service times, events and how to reach us.",
    chips: ["Service times", "Upcoming events", "Get directions"],
  });
}
