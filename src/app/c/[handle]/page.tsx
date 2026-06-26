import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import {
  Globe,
  Link2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  type LucideIcon,
} from "lucide-react";
import { db } from "@/db";
import { church, service } from "@/db/schema";
import { siteUrl, churchUrl } from "@/lib/site";
import { ShareButton } from "@/components/public/share-button";

export const revalidate = 3600;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function getChurch(handle: string) {
  const [c] = await db
    .select()
    .from(church)
    .where(and(eq(church.handle, handle), eq(church.publicEnabled, true)))
    .limit(1);
  return c ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const c = await getChurch(handle);
  if (!c) return { title: "Church not found" };
  const desc =
    c.tagline ||
    c.about?.slice(0, 160) ||
    `${c.name}${c.city ? ` in ${c.city}` : ""} on FlockInsight.`;
  const img = c.coverUrl || c.logo;
  return {
    title: `${c.name} · FlockInsight`,
    description: desc,
    openGraph: {
      title: c.name,
      description: desc,
      url: churchUrl(handle),
      images: img ? [`${siteUrl()}${img}`] : undefined,
      type: "website",
    },
    twitter: { card: "summary_large_image", title: c.name, description: desc },
  };
}

function socialHref(key: string, value: string): string {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, "");
  switch (key) {
    case "facebook": return `https://facebook.com/${handle}`;
    case "instagram": return `https://instagram.com/${handle}`;
    case "youtube": return `https://youtube.com/${handle}`;
    case "tiktok": return `https://tiktok.com/@${handle}`;
    case "x": return `https://x.com/${handle}`;
    case "whatsapp": return `https://wa.me/${v.replace(/[^0-9]/g, "")}`;
    default: return v;
  }
}

const SOCIAL_ICON: Record<string, LucideIcon> = {
  whatsapp: MessageCircle,
  // This lucide build has no brand glyphs — use a generic link icon; the
  // visible label (Facebook, Instagram, …) makes the platform clear.
  facebook: Link2,
  instagram: Link2,
  youtube: Link2,
  tiktok: Link2,
  x: Link2,
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export default async function ChurchPublicPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const c = await getChurch(handle);
  if (!c) notFound();

  const services = await db
    .select({
      name: service.name,
      dayOfWeek: service.dayOfWeek,
      startTime: service.startTime,
    })
    .from(service)
    .where(and(eq(service.churchId, c.id), eq(service.isActive, true)))
    .orderBy(asc(service.sortOrder));

  const url = churchUrl(handle);
  const locationLine = [c.addressText, c.city, c.state, c.country]
    .filter(Boolean)
    .join(", ");
  const mapHref =
    c.lat != null && c.lng != null
      ? `https://www.google.com/maps?q=${c.lat},${c.lng}`
      : locationLine
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.name} ${locationLine}`)}`
        : null;
  const socials = Object.entries(c.socials ?? {}).filter(([, v]) => v);

  return (
    <div className="min-h-dvh bg-slate-50 pb-16 text-slate-900 dark:bg-slate-950 dark:text-slate-50">
      {/* Hero */}
      <div className="relative">
        <div className="h-44 w-full overflow-hidden bg-gradient-to-br from-violet-600 to-indigo-600 sm:h-64">
          {c.coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.coverUrl} alt="" className="size-full object-cover" />
          )}
        </div>
        <div className="mx-auto max-w-3xl px-4">
          <div className="-mt-12 flex items-end gap-4">
            <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-2xl border-4 border-white bg-white shadow-lg dark:border-slate-900 dark:bg-slate-800">
              {c.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.logo} alt="" className="size-full object-cover" />
              ) : (
                <span className="text-2xl font-extrabold text-violet-600">
                  {initials(c.name)}
                </span>
              )}
            </div>
            <div className="mb-2">
              <ShareButton url={url} title={c.name} />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-6 px-4 pt-4">
        {/* Identity */}
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            {c.name}
          </h1>
          {c.tagline && (
            <p className="mt-1 text-lg text-slate-600 dark:text-slate-300">
              {c.tagline}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {c.denomination && (
              <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                {c.denomination}
              </span>
            )}
            {(c.city || c.state) && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <MapPin className="size-3" />
                {[c.city, c.state].filter(Boolean).join(", ")}
              </span>
            )}
          </div>
        </div>

        {/* About */}
        {c.about && (
          <section className="rounded-2xl border bg-white p-5 shadow-sm dark:bg-slate-900">
            <h2 className="mb-2 text-lg font-bold">About us</h2>
            <p className="whitespace-pre-line leading-relaxed text-slate-700 dark:text-slate-300">
              {c.about}
            </p>
          </section>
        )}

        {/* Service times */}
        {services.length > 0 && (
          <section className="rounded-2xl border bg-white p-5 shadow-sm dark:bg-slate-900">
            <h2 className="mb-3 text-lg font-bold">Service times</h2>
            <ul className="space-y-2">
              {services.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{s.name}</span>
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    {[s.dayOfWeek != null ? DAYS[s.dayOfWeek] : null, s.startTime]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Location */}
        {(locationLine || c.landmarks) && (
          <section className="rounded-2xl border bg-white p-5 shadow-sm dark:bg-slate-900">
            <h2 className="mb-2 text-lg font-bold">Find us</h2>
            {locationLine && <p className="text-slate-700 dark:text-slate-300">{locationLine}</p>}
            {c.landmarks && (
              <p className="mt-1 text-sm text-slate-500">Landmark: {c.landmarks}</p>
            )}
            {mapHref && (
              <a
                href={mapHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-violet-700"
              >
                <MapPin className="size-4" /> Get directions
              </a>
            )}
          </section>
        )}

        {/* Photos */}
        {c.photos && c.photos.length > 0 && (
          <section className="rounded-2xl border bg-white p-5 shadow-sm dark:bg-slate-900">
            <h2 className="mb-3 text-lg font-bold">Photos</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {c.photos.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={p.url}
                  src={p.url}
                  alt={p.caption ?? ""}
                  loading="lazy"
                  className="aspect-square w-full rounded-lg object-cover"
                />
              ))}
            </div>
          </section>
        )}

        {/* Contact */}
        {(c.publicPhone || c.publicEmail || c.website || socials.length > 0) && (
          <section className="rounded-2xl border bg-white p-5 shadow-sm dark:bg-slate-900">
            <h2 className="mb-3 text-lg font-bold">Get in touch</h2>
            <div className="flex flex-wrap gap-2">
              {c.publicPhone && (
                <a href={`tel:${c.publicPhone}`} className="contact-chip">
                  <Phone className="size-4" /> {c.publicPhone}
                </a>
              )}
              {c.publicEmail && (
                <a href={`mailto:${c.publicEmail}`} className="contact-chip">
                  <Mail className="size-4" /> {c.publicEmail}
                </a>
              )}
              {c.website && (
                <a
                  href={/^https?:\/\//.test(c.website) ? c.website : `https://${c.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Globe className="size-4" /> Website
                </a>
              )}
              {socials.map(([key, value]) => {
                const Icon = SOCIAL_ICON[key] ?? Globe;
                return (
                  <a
                    key={key}
                    href={socialHref(key, value)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold capitalize transition hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Icon className="size-4" /> {key === "x" ? "X" : key}
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {/* Footer CTA */}
        <div className="pt-4 text-center">
          <ShareButton
            url={url}
            title={c.name}
            className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-bold text-white shadow transition hover:bg-violet-700"
          />
          <p className="mt-4 text-xs text-slate-400">
            <Link href="/" className="font-semibold hover:underline">
              Powered by FlockInsight
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
