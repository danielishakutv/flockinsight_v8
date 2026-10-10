import { and, eq } from "drizzle-orm";
import { format, parseISO } from "date-fns";
import { db } from "@/db";
import { church, event } from "@/db/schema";
import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";

/**
 * An event's link preview: the date and the venue, large.
 *
 * The flyer is not used, for a reason worth writing down because it looks
 * wrong at first glance. Church flyers are portrait — 1080×1350 or taller —
 * and a portrait image in a 1200×630 slot gets centre-cropped by every
 * platform, which takes the top and bottom off. On a crusade flyer that is the
 * event name and the date: the two things the preview exists to communicate.
 * The flyer still leads the event page, where it is shown whole.
 *
 * So the card states the facts as type instead, which survives any crop and
 * stays readable at the size WhatsApp draws it in a group chat.
 */
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Church event on FlockInsight";
export const revalidate = 3600;

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Same guard the page uses: an id that is not a uuid never reaches the DB.
  const [e] = /^[0-9a-f-]{36}$/i.test(id)
    ? await db
        .select({
          title: event.title,
          description: event.description,
          date: event.date,
          startTime: event.startTime,
          venue: event.venue,
          churchName: church.name,
          city: church.city,
        })
        .from(event)
        .innerJoin(church, eq(church.id, event.churchId))
        .where(and(eq(event.id, id), eq(event.isPublic, true)))
        .limit(1)
    : [null];

  if (!e) {
    return ogCard({
      eyebrow: "Church events",
      title: "Find a church programme near you",
      subtitle: "Crusades, conventions and services published by churches on FlockInsight.",
    });
  }

  /*
   * A bad date string must not take the card down with it. `parseISO` on
   * malformed input yields an Invalid Date, and formatting that throws — which
   * would turn a shareable link into a broken image rather than an error
   * anybody sees.
   */
  let when = "";
  try {
    const d = parseISO(e.date);
    if (!Number.isNaN(d.getTime())) when = format(d, "EEEE d MMMM yyyy");
  } catch (err) {
    console.error("[og] unparseable event date", { id, date: e.date, err });
  }

  const chips = [
    when,
    e.startTime ? `from ${e.startTime}` : "",
    e.venue || e.city || "",
  ].filter(Boolean);

  return ogCard({
    variant: "church",
    eyebrow: e.churchName,
    title: e.title,
    subtitle: e.description?.replace(/\s+/g, " ").trim().slice(0, 150) || undefined,
    chips,
  });
}
