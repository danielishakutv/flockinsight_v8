import type { MetadataRoute } from "next";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { church, event } from "@/db/schema";

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
    { path: "/login", priority: 0.4, freq: "monthly" },
    { path: "/changelog", priority: 0.4, freq: "weekly" },
    { path: "/terms", priority: 0.3, freq: "monthly" },
    { path: "/privacy", priority: 0.3, freq: "monthly" },
  ];

  const base: MetadataRoute.Sitemap = staticRoutes.map((r) => ({
    url: `${BASE}${r.path}`,
    changeFrequency: r.freq,
    priority: r.priority,
  }));

  // Public church pages + public upcoming events — helps churches get indexed.
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [churches, events] = await Promise.all([
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
    ]);

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
