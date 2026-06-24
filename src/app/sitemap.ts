import type { MetadataRoute } from "next";

const BASE = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes: { path: string; priority: number; freq: "weekly" | "monthly" }[] =
    [
      { path: "", priority: 1, freq: "weekly" },
      { path: "/pricing", priority: 0.9, freq: "weekly" },
      { path: "/login", priority: 0.5, freq: "monthly" },
      { path: "/signup", priority: 0.7, freq: "monthly" },
      { path: "/terms", priority: 0.3, freq: "monthly" },
      { path: "/privacy", priority: 0.3, freq: "monthly" },
      { path: "/changelog", priority: 0.4, freq: "weekly" },
    ];
  return routes.map((r) => ({
    url: `${BASE}${r.path}`,
    changeFrequency: r.freq,
    priority: r.priority,
  }));
}
