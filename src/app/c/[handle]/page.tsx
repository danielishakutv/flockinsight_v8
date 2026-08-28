import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, gte } from "drizzle-orm";
import {
  ArrowRight,
  CalendarDays,
  Clock,
  Globe,
  Link2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  type LucideIcon,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { db } from "@/db";
import { church, service, event } from "@/db/schema";
import { siteUrl, churchUrl } from "@/lib/site";
import { getTheme, themeVars } from "@/lib/church-themes";
import { ShareButton } from "@/components/public/share-button";
import { NewsletterSignup } from "@/components/public/newsletter-signup";
import { PublicThemeToggle } from "@/components/public/public-theme-toggle";
import { JsonLd } from "@/components/seo/json-ld";
import { VerifiedTick } from "@/components/app/verified-tick";
import { isChurchVerified } from "@/lib/verification-shared";

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
    alternates: { canonical: churchUrl(handle) },
    openGraph: {
      title: c.name,
      description: desc,
      url: churchUrl(handle),
      images: img ? [img.startsWith("http") ? img : `${siteUrl()}${img}`] : undefined,
      type: "website",
    },
    twitter: { card: "summary_large_image", title: c.name, description: desc },
  };
}

/** Absolute URL for an asset that may be a Cloudinary URL or a /media path. */
function abs(u: string | null): string | undefined {
  if (!u) return undefined;
  return u.startsWith("http") ? u : `${siteUrl()}${u}`;
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

  const today = new Date().toISOString().slice(0, 10);
  const [services, events] = await Promise.all([
    db
      .select({
        name: service.name,
        dayOfWeek: service.dayOfWeek,
        startTime: service.startTime,
      })
      .from(service)
      .where(and(eq(service.churchId, c.id), eq(service.isActive, true)))
      .orderBy(asc(service.sortOrder)),
    db
      .select({
        id: event.id,
        title: event.title,
        flyerUrl: event.flyerUrl,
        date: event.date,
        startTime: event.startTime,
        venue: event.venue,
      })
      .from(event)
      .where(
        and(
          eq(event.churchId, c.id),
          eq(event.isPublic, true),
          gte(event.date, today),
        ),
      )
      .orderBy(asc(event.date))
      .limit(6),
  ]);

  const theme = getTheme(c.theme);
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

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Church",
    name: c.name,
    url,
    ...(abs(c.logo) ? { logo: abs(c.logo) } : {}),
    ...(abs(c.coverUrl) || abs(c.logo) ? { image: abs(c.coverUrl) || abs(c.logo) } : {}),
    ...(c.about ? { description: c.about.slice(0, 300) } : c.tagline ? { description: c.tagline } : {}),
    ...(c.publicPhone ? { telephone: c.publicPhone } : {}),
    ...(c.publicEmail ? { email: c.publicEmail } : {}),
    ...(locationLine || c.city || c.state
      ? {
          address: {
            "@type": "PostalAddress",
            ...(c.addressText ? { streetAddress: c.addressText } : {}),
            ...(c.city ? { addressLocality: c.city } : {}),
            ...(c.state ? { addressRegion: c.state } : {}),
            ...(c.country ? { addressCountry: c.country } : {}),
          },
        }
      : {}),
    ...(c.lat != null && c.lng != null
      ? { geo: { "@type": "GeoCoordinates", latitude: c.lat, longitude: c.lng } }
      : {}),
    ...(socials.length ? { sameAs: socials.map(([k, v]) => socialHref(k, v)) } : {}),
  };

  return (
    <div
      style={themeVars(theme)}
      className="min-h-dvh bg-white pb-20 text-slate-900 dark:bg-slate-950 dark:text-slate-50"
    >
      <JsonLd data={jsonLd} />
      <PublicThemeToggle />

      {/* ===== Hero ===== */}
      <header className="relative isolate overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[var(--brand-from)] to-[var(--brand-to)]" />
        {c.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.coverUrl}
            alt=""
            className="absolute inset-0 -z-10 size-full object-cover opacity-40 mix-blend-overlay"
          />
        )}
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/60 via-black/10 to-black/30" />

        <div className="mx-auto flex min-h-[26rem] max-w-5xl flex-col justify-end px-4 pb-10 pt-24 sm:min-h-[32rem] sm:px-8">
          <div className="flex items-end gap-4">
            <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/30 bg-white/95 shadow-xl backdrop-blur sm:size-24">
              {c.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.logo} alt="" className="size-full object-cover" />
              ) : (
                <span className="text-2xl font-extrabold text-[var(--brand)]">
                  {initials(c.name)}
                </span>
              )}
            </div>
          </div>

          <h1 className="mt-5 flex flex-wrap items-center gap-2 text-4xl font-extrabold tracking-tight text-white drop-shadow-sm sm:text-6xl">
            {c.name}
            {isChurchVerified(c) && (
              <VerifiedTick
                className="size-6 fill-white text-[var(--brand)] sm:size-8"
                label={`${c.name} is a verified church on FlockInsight`}
              />
            )}
          </h1>
          {c.tagline && (
            <p className="mt-2 max-w-2xl text-lg text-white/90 sm:text-xl">
              {c.tagline}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {c.denomination && (
              <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold text-white backdrop-blur">
                {c.denomination}
              </span>
            )}
            {(c.city || c.state) && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-xs font-bold text-white backdrop-blur">
                <MapPin className="size-3" />
                {[c.city, c.state].filter(Boolean).join(", ")}
              </span>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="#subscribe"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-[var(--brand)] shadow-lg transition hover:bg-white/90"
            >
              <Mail className="size-4" /> Subscribe
            </a>
            {mapHref && (
              <a
                href={mapHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/10 px-6 py-3 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20"
              >
                <MapPin className="size-4" /> Directions
              </a>
            )}
            <ShareButton
              url={url}
              title={c.name}
              className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/10 px-6 py-3 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20"
            />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-10 px-4 pt-12 sm:px-8">
        {/* ===== About ===== */}
        {c.about && (
          <section>
            <SectionTitle>About us</SectionTitle>
            <p className="mt-3 max-w-3xl whitespace-pre-line text-lg leading-relaxed text-slate-700 dark:text-slate-300">
              {c.about}
            </p>
          </section>
        )}

        {/* ===== Service times ===== */}
        {services.length > 0 && (
          <section>
            <SectionTitle>Service times</SectionTitle>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {services.map((s, i) => (
                <div
                  key={i}
                  className="rounded-2xl border bg-white p-4 shadow-sm dark:bg-slate-900"
                >
                  <div className="flex items-center gap-2">
                    <span className="grid size-9 place-items-center rounded-lg bg-[var(--brand)]/10 text-[var(--brand)]">
                      <Clock className="size-4" />
                    </span>
                    <p className="font-bold">{s.name}</p>
                  </div>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    {[s.dayOfWeek != null ? DAYS[s.dayOfWeek] : null, s.startTime]
                      .filter(Boolean)
                      .join(" · ") || "Time varies"}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ===== Upcoming events ===== */}
        {events.length > 0 && (
          <section>
            <div className="flex items-center justify-between">
              <SectionTitle>Upcoming events</SectionTitle>
              <Link
                href="/events"
                className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--brand)] hover:underline"
              >
                See all <ArrowRight className="size-4" />
              </Link>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {events.map((ev) => (
                <Link
                  key={ev.id}
                  href={`/events/${ev.id}`}
                  className="group overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-900"
                >
                  <div className="relative aspect-[16/9] bg-[var(--brand)]/10">
                    {ev.flyerUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={ev.flyerUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="grid size-full place-items-center text-[var(--brand)]">
                        <CalendarDays className="size-10" />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-[var(--brand)]">
                      {format(parseISO(ev.date), "EEE, MMM d")}
                      {ev.startTime ? ` · ${ev.startTime}` : ""}
                    </p>
                    <p className="mt-1 font-bold">{ev.title}</p>
                    {ev.venue && (
                      <p className="mt-0.5 truncate text-sm text-slate-500">{ev.venue}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ===== Gallery ===== */}
        {c.photos && c.photos.length > 0 && (
          <section>
            <SectionTitle>Gallery</SectionTitle>
            <div className="mt-4 columns-2 gap-3 sm:columns-3 [&>*]:mb-3">
              {c.photos.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={p.url}
                  src={p.url}
                  alt={p.caption ?? ""}
                  loading="lazy"
                  className="w-full break-inside-avoid rounded-2xl object-cover shadow-sm"
                />
              ))}
            </div>
          </section>
        )}

        {/* ===== Find us ===== */}
        {(locationLine || c.landmarks) && (
          <section className="rounded-3xl border bg-slate-50 p-6 dark:bg-slate-900/60">
            <SectionTitle>Find us</SectionTitle>
            {locationLine && (
              <p className="mt-2 text-slate-700 dark:text-slate-300">{locationLine}</p>
            )}
            {c.landmarks && (
              <p className="mt-1 text-sm text-slate-500">Landmark: {c.landmarks}</p>
            )}
            {mapHref && (
              <a
                href={mapHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-bold text-white shadow transition hover:opacity-90"
              >
                <MapPin className="size-4" /> Get directions
              </a>
            )}
          </section>
        )}

        {/* ===== Contact ===== */}
        {(c.publicPhone || c.publicEmail || c.website || socials.length > 0) && (
          <section>
            <SectionTitle>Get in touch</SectionTitle>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {c.publicPhone && (
                <a
                  href={`tel:${c.publicPhone}`}
                  className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Phone className="size-4 text-[var(--brand)]" /> {c.publicPhone}
                </a>
              )}
              {c.publicEmail && (
                <a
                  href={`mailto:${c.publicEmail}`}
                  className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Mail className="size-4 text-[var(--brand)]" /> {c.publicEmail}
                </a>
              )}
              {c.website && (
                <a
                  href={/^https?:\/\//.test(c.website) ? c.website : `https://${c.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Globe className="size-4 text-[var(--brand)]" /> Website
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
                    className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold capitalize transition hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Icon className="size-4 text-[var(--brand)]" /> {key === "x" ? "X" : key}
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {/* ===== Subscribe band ===== */}
        <section
          id="subscribe"
          className="overflow-hidden rounded-3xl bg-gradient-to-br from-[var(--brand-from)] to-[var(--brand-to)] p-6 shadow-lg sm:p-10"
        >
          <h2 className="text-2xl font-extrabold text-white sm:text-3xl">
            Stay connected
          </h2>
          <p className="mt-1 max-w-xl text-white/85">
            Subscribe to get devotionals, newsletters and updates from {c.name}{" "}
            straight to your inbox.
          </p>
          <div className="mt-5 max-w-2xl">
            <NewsletterSignup handle={handle} churchName={c.name} />
          </div>
        </section>

        {/* ===== "Get your own page" nudge ===== */}
        <div className="rounded-3xl border border-dashed bg-slate-50 p-6 text-center dark:bg-slate-900/60">
          <p className="text-lg font-bold">Do you lead a church or fellowship?</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            Get a beautiful page like this — plus attendance, members, giving,
            devotionals and more — free on FlockInsight.
          </p>
          <Link
            href="/signup"
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-6 py-3 text-sm font-bold text-white shadow transition hover:opacity-90"
          >
            <ArrowRight className="size-4" /> Create your free church page
          </Link>
        </div>

        {/* ===== Footer ===== */}
        <div className="pt-2 text-center text-xs text-slate-400">
          <Link href="/churches" className="font-semibold hover:underline">
            Find more churches
          </Link>
          {" · "}
          <Link href="/" className="font-semibold hover:underline">
            Powered by FlockInsight
          </Link>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
      <span className="bg-gradient-to-r from-[var(--brand-from)] to-[var(--brand-to)] bg-clip-text text-transparent">
        {children}
      </span>
    </h2>
  );
}
