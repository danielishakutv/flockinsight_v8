import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { format, parseISO } from "date-fns";
import { ArrowLeft, CalendarDays, Clock, MapPin } from "lucide-react";
import { db } from "@/db";
import { church, event } from "@/db/schema";
import { siteUrl } from "@/lib/site";
import { ShareButton } from "@/components/public/share-button";

export const revalidate = 600;

async function getEvent(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({
      id: event.id,
      title: event.title,
      description: event.description,
      flyerUrl: event.flyerUrl,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      venue: event.venue,
      address: event.address,
      isPublic: event.isPublic,
      churchName: church.name,
      handle: church.handle,
      city: church.city,
      state: church.state,
      country: church.country,
      lat: church.lat,
      lng: church.lng,
    })
    .from(event)
    .innerJoin(church, eq(church.id, event.churchId))
    .where(and(eq(event.id, id), eq(event.isPublic, true)))
    .limit(1);
  return row ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const e = await getEvent(id);
  if (!e) return { title: "Event not found" };
  const desc = e.description?.slice(0, 160) || `${e.title} at ${e.churchName}`;
  return {
    title: `${e.title} · ${e.churchName}`,
    description: desc,
    openGraph: {
      title: e.title,
      description: desc,
      images: e.flyerUrl ? [`${siteUrl()}${e.flyerUrl}`] : undefined,
      type: "website",
    },
  };
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const e = await getEvent(id);
  if (!e) notFound();

  const place = [e.venue, e.address, e.city, e.state, e.country]
    .filter(Boolean)
    .join(", ");
  const mapHref =
    e.lat != null && e.lng != null
      ? `https://www.google.com/maps?q=${e.lat},${e.lng}`
      : place
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`
        : null;
  const url = `${siteUrl()}/events/${e.id}`;

  return (
    <div className="min-h-dvh bg-slate-50 pb-16 dark:bg-slate-950">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Link
          href="/events"
          className="text-muted-foreground inline-flex items-center gap-1 text-sm font-semibold hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All events
        </Link>

        <div className="mt-4 overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-slate-900">
          {e.flyerUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={e.flyerUrl} alt="" className="max-h-[28rem] w-full object-contain bg-black/5" />
          )}
          <div className="space-y-4 p-5">
            <div>
              <p className="text-primary text-sm font-bold uppercase">
                {format(parseISO(e.date), "EEEE, MMMM d, yyyy")}
              </p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
                {e.title}
              </h1>
              <p className="text-muted-foreground mt-1">
                Hosted by{" "}
                {e.handle ? (
                  <Link href={`/c/${e.handle}`} className="text-primary font-semibold hover:underline">
                    {e.churchName}
                  </Link>
                ) : (
                  e.churchName
                )}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-sm">
              {(e.startTime || e.endTime) && (
                <span className="bg-muted inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold">
                  <Clock className="size-4" />
                  {e.startTime}
                  {e.endTime ? ` – ${e.endTime}` : ""}
                </span>
              )}
              {place && (
                <span className="bg-muted inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold">
                  <MapPin className="size-4" /> {e.venue || e.city || "See details"}
                </span>
              )}
            </div>

            {e.description && (
              <p className="whitespace-pre-line leading-relaxed text-slate-700 dark:text-slate-300">
                {e.description}
              </p>
            )}

            {place && (
              <p className="text-muted-foreground text-sm">
                <CalendarDays className="mr-1 inline size-4" />
                {place}
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {mapHref && (
                <a
                  href={mapHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-violet-700"
                >
                  <MapPin className="size-4" /> Get directions
                </a>
              )}
              <ShareButton
                url={url}
                title={e.title}
                className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition hover:bg-muted"
              />
            </div>
          </div>
        </div>

        <p className="text-muted-foreground mt-6 text-center text-xs">
          <Link href="/events" className="font-semibold hover:underline">More events</Link>
          {" · "}
          <Link href="/" className="font-semibold hover:underline">Powered by FlockInsight</Link>
        </p>
      </div>
    </div>
  );
}
