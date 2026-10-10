import type { MetadataRoute } from "next";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { church, event } from "@/db/schema";
import { publishedSlugs } from "@/lib/blog";
import { allSeoPaths, COMPARE_BASE, GEO_BASE, SOLUTION_BASE } from "@/lib/seo/pages";
import { INDEXED_LOCALES, withLang } from "@/lib/seo/alternates";

const BASE = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static marketing/legal routes.
  const staticRoutes: {
    path: string;
    priority: number;
    freq: "weekly" | "monthly" | "daily";
  }[] = [
    { path: "", priority: 1, freq: "weekly" },
    { path: "/pricing", priority: 0.9, freq: "weekly" },
    { path: "/churches", priority: 0.8, freq: "daily" },
    { path: "/events", priority: 0.7, freq: "daily" },
    { path: "/signup", priority: 0.7, freq: "monthly" },
    { path: "/demo", priority: 0.8, freq: "monthly" },
    { path: "/login", priority: 0.4, freq: "monthly" },
    { path: "/blog", priority: 0.7, freq: "weekly" },
    { path: "/changelog", priority: 0.4, freq: "weekly" },
    { path: "/roadmap", priority: 0.4, freq: "weekly" },
    { path: "/terms", priority: 0.3, freq: "monthly" },
    { path: "/privacy", priority: 0.3, freq: "monthly" },
    // The three hubs above the generated pages. High priority: they are where
    // a set of pages becomes a topic rather than twenty-two orphans.
    { path: GEO_BASE, priority: 0.9, freq: "weekly" },
    { path: SOLUTION_BASE, priority: 0.9, freq: "weekly" },
    { path: COMPARE_BASE, priority: 0.8, freq: "weekly" },
    /*
     * The twenty-two generated pages. 0.7 rather than 0.9: a priority is a
     * hint about relative importance within our own site, and claiming a
     * country page matters as much as the home page is the kind of noise that
     * makes a crawler stop reading the hints at all.
     */
    ...allSeoPaths().map(
      (path) => ({ path, priority: 0.7, freq: "monthly" as const }),
    ),
  ];

  /*
   * Each marketing URL, with its language alternates declared.
   *
   * `alternates.languages` in a sitemap is the other half of the hreflang tags
   * on the pages themselves. Both are valid on their own, but Google treats
   * them as corroborating signals and a set declared in only one place is
   * trusted less — which matters here because the French and Portuguese copy
   * was invisible to search entirely until this release: language lived in a
   * cookie, and a crawler has no cookie.
   *
   * Only the three reviewed languages are listed. The other five have app
   * dictionaries but no reviewed landing copy, so they serve English, and
   * advertising an hreflang that resolves to the wrong language teaches a
   * crawler to distrust the rest of the annotations.
   */
  const base: MetadataRoute.Sitemap = staticRoutes.map((r) => ({
    url: `${BASE}${r.path}`,
    changeFrequency: r.freq,
    priority: r.priority,
    alternates: {
      languages: Object.fromEntries(
        INDEXED_LOCALES.map((code) => [code, `${BASE}${withLang(r.path, code)}`]),
      ),
    },
  }));

  // Public church pages + public upcoming events — helps churches get indexed.
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [churches, events, posts] = await Promise.all([
      db
        .select({ handle: church.handle })
        .from(church)
        .where(and(eq(church.publicEnabled, true), isNotNull(church.handle)))
        .limit(5000),
      db
        .select({ id: event.id })
        .from(event)
        .where(and(eq(event.isPublic, true), gte(event.date, today)))
        .limit(5000),
      publishedSlugs(),
    ]);

    for (const p of posts) {
      base.push({
        url: `${BASE}/blog/${p.slug}`,
        lastModified: p.updatedAt,
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }

    for (const c of churches) {
      if (!c.handle) continue;
      base.push({
        url: `${BASE}/c/${c.handle}`,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
    for (const e of events) {
      base.push({
        url: `${BASE}/events/${e.id}`,
        changeFrequency: "weekly",
        priority: 0.5,
      });
    }
  } catch {
    // If the DB is unreachable at build/request time, still return static URLs.
  }

  return base;
}
