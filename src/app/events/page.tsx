import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { format, parseISO } from "date-fns";
import { CalendarDays, Clock, MapPin } from "lucide-react";
import { db } from "@/db";
import { church, event } from "@/db/schema";
import { EventsSearch } from "@/components/public/events-search";
import { BannerSlot } from "@/components/public/banner-slot";

export const metadata: Metadata = {
  title: "Church events near you · FlockInsight",
  description: "Discover upcoming church events, services and programs near you.",
};

const LIMIT = 60;

function str(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}
function parseNear(v: string): { lat: number; lng: number } | null {
  const m = v.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export default async function EventsDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = str(sp.q);
  const near = parseNear(str(sp.near));
  const today = new Date().toISOString().slice(0, 10);

  const conds = [
    eq(event.isPublic, true),
    gte(event.date, today),
    eq(church.publicEnabled, true),
  ];
  if (q)
    conds.push(
      or(
        ilike(event.title, `%${q}%`),
        ilike(event.description, `%${q}%`),
        ilike(event.venue, `%${q}%`),
        ilike(church.name, `%${q}%`),
        ilike(church.city, `%${q}%`),
      )!,
    );

  const distExpr = near
    ? sql<number>`6371 * acos(greatest(-1, least(1, cos(radians(${near.lat})) * cos(radians(${church.lat})) * cos(radians(${church.lng}) - radians(${near.lng})) + sin(radians(${near.lat})) * sin(radians(${church.lat})))))`
    : null;

  const base = db
    .select({
      id: event.id,
      title: event.title,
      flyerUrl: event.flyerUrl,
      date: event.date,
      startTime: event.startTime,
      venue: event.venue,
      churchName: church.name,
      handle: church.handle,
      city: church.city,
      state: church.state,
      lat: church.lat,
      lng: church.lng,
    })
    .from(event)
    .innerJoin(church, eq(church.id, event.churchId))
    .where(and(...conds))
    .limit(LIMIT);

  const rows = await (distExpr
    ? base.orderBy(sql`${distExpr} asc nulls last`, asc(event.date))
    : base.orderBy(asc(event.date)));

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <div className="bg-gradient-to-br from-violet-600 to-indigo-600 px-4 py-10 text-white">
        <div className="mx-auto max-w-5xl">
          <Link href="/" className="text-sm font-semibold text-white/80 hover:text-white">
            ← FlockInsight
          </Link>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
            What&apos;s on
          </h1>
          <p className="mt-1 text-white/80">
            Upcoming church events, services and programs near you.
          </p>
          <div className="mt-3 flex gap-3 text-sm font-semibold text-white/90">
            <Link href="/churches" className="hover:text-white">Find a church →</Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="-mt-12 rounded-2xl border bg-white p-4 shadow-lg dark:bg-slate-900">
          <EventsSearch initialQ={q} near={!!near} />
        </div>

        <div className="mt-5">
          <BannerSlot placement="events" />
        </div>

        <p className="text-muted-foreground mt-5 text-sm">
          {rows.length === 0
            ? "No upcoming events found."
            : `${rows.length}${rows.length === LIMIT ? "+" : ""} upcoming event${rows.length === 1 ? "" : "s"}`}
          {near ? " · nearest first" : ""}
        </p>

        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((e) => {
            const dist =
              near && e.lat != null && e.lng != null
                ? haversineKm(near, { lat: e.lat, lng: e.lng })
                : null;
            return (
              <Link
                key={e.id}
                href={`/events/${e.id}`}
                className="group flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:shadow-md dark:bg-slate-900"
              >
                <div className="aspect-video w-full overflow-hidden bg-violet-100 dark:bg-violet-500/10">
                  {e.flyerUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.flyerUrl} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <div className="grid size-full place-items-center">
                      <CalendarDays className="size-10 text-violet-400" />
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <p className="text-primary text-xs font-bold uppercase">
                    {format(parseISO(e.date), "EEE, MMM d")}
                    {e.startTime ? ` · ${e.startTime}` : ""}
                  </p>
                  <p className="mt-1 font-bold leading-tight group-hover:text-violet-600">
                    {e.title}
                  </p>
                  <p className="text-muted-foreground mt-1 text-sm">{e.churchName}</p>
                  <p className="text-muted-foreground mt-auto pt-2 text-xs">
                    {e.venue && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" /> {e.venue}
                      </span>
                    )}
                    {dist != null && (
                      <span className="text-violet-600"> · {dist < 1 ? "<1" : Math.round(dist)} km</span>
                    )}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
