import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { MapPin, Star } from "lucide-react";
import { db } from "@/db";
import { church } from "@/db/schema";
import { COUNTRIES } from "@/lib/geo";
import { DirectorySearch } from "@/components/public/directory-search";
import { BannerSlot } from "@/components/public/banner-slot";

export const metadata: Metadata = {
  title: "Find a church · FlockInsight",
  description:
    "Discover churches near you. Search by name, denomination or location.",
};

const RESULT_LIMIT = 60;

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

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
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

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export default async function ChurchDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = str(sp.q);
  const country = str(sp.country);
  const denom = str(sp.denom);
  const near = parseNear(str(sp.near));

  const conds = [eq(church.publicEnabled, true), isNotNull(church.handle)];
  if (q)
    conds.push(
      or(
        ilike(church.name, `%${q}%`),
        ilike(church.denomination, `%${q}%`),
        ilike(church.city, `%${q}%`),
        ilike(church.tagline, `%${q}%`),
        ilike(church.about, `%${q}%`),
      )!,
    );
  if (country) conds.push(eq(church.country, country));
  if (denom) conds.push(ilike(church.denomination, `%${denom}%`));

  const distExpr = near
    ? sql<number>`6371 * acos(greatest(-1, least(1, cos(radians(${near.lat})) * cos(radians(${church.lat})) * cos(radians(${church.lng}) - radians(${near.lng})) + sin(radians(${near.lat})) * sin(radians(${church.lat})))))`
    : null;

  const baseQuery = db
    .select({
      name: church.name,
      handle: church.handle,
      denomination: church.denomination,
      tagline: church.tagline,
      logo: church.logo,
      coverUrl: church.coverUrl,
      featured: church.featured,
      city: church.city,
      state: church.state,
      country: church.country,
      lat: church.lat,
      lng: church.lng,
    })
    .from(church)
    .where(and(...conds))
    .limit(RESULT_LIMIT);

  const rows = await (distExpr
    ? baseQuery.orderBy(sql`${distExpr} asc nulls last`)
    : baseQuery.orderBy(desc(church.featured), asc(church.name)));

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <div className="bg-gradient-to-br from-violet-600 to-indigo-600 px-4 py-10 text-white">
        <div className="mx-auto max-w-4xl">
          <Link href="/" className="text-sm font-semibold text-white/80 hover:text-white">
            ← FlockInsight
          </Link>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Find a church
          </h1>
          <p className="mt-1 text-white/80">
            Discover churches near you — search by name, denomination or place.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="-mt-12 rounded-2xl border bg-white p-4 shadow-lg dark:bg-slate-900">
          <DirectorySearch
            countries={COUNTRIES}
            initialQ={q}
            initialCountry={country}
            initialDenom={denom}
            near={!!near}
          />
        </div>

        <div className="mt-5">
          <BannerSlot placement="directory" />
        </div>

        <p className="text-muted-foreground mt-5 text-sm">
          {rows.length === 0
            ? "No churches found. Try a different search."
            : `${rows.length}${rows.length === RESULT_LIMIT ? "+" : ""} church${rows.length === 1 ? "" : "es"}`}
          {near ? " · nearest first" : ""}
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {rows.map((c) => {
            const dist =
              near && c.lat != null && c.lng != null
                ? haversineKm(near, { lat: c.lat, lng: c.lng })
                : null;
            const place = [c.city, c.state, c.country].filter(Boolean).join(", ");
            return (
              <Link
                key={c.handle}
                href={`/c/${c.handle}`}
                className="group flex gap-3 rounded-2xl border bg-white p-4 shadow-sm transition hover:shadow-md dark:bg-slate-900"
              >
                <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-violet-100 dark:bg-violet-500/15">
                  {c.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.logo} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="font-extrabold text-violet-600">
                      {initials(c.name)}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-bold group-hover:text-violet-600">
                    {c.name}
                    {c.featured && (
                      <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />
                    )}
                  </p>
                  {c.denomination && (
                    <p className="text-muted-foreground truncate text-xs font-semibold">
                      {c.denomination}
                    </p>
                  )}
                  {c.tagline && (
                    <p className="text-muted-foreground mt-0.5 line-clamp-1 text-sm">
                      {c.tagline}
                    </p>
                  )}
                  {(place || dist != null) && (
                    <p className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
                      <MapPin className="size-3" />
                      {place || "—"}
                      {dist != null && (
                        <span className="text-violet-600">
                          · {dist < 1 ? "<1" : Math.round(dist)} km
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
