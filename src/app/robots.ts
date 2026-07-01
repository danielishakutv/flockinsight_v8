import type { MetadataRoute } from "next";

const BASE = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Keep private app surfaces out of search indexes.
        disallow: [
          "/api/",
          "/dashboard",
          "/settings",
          "/superadmin",
          "/members",
          "/giving",
          "/attendance",
          "/groups",
          "/follow-up",
          "/analytics",
          "/media",
          "/forms",
          "/devotionals",
          "/communication",
          "/my-events",
          "/notifications",
          "/help",
          "/onboarding",
          "/accept-invitation",
          "/reports",
          "/set-password",
          "/suspended",
          "/f/",
          "/n/",
        ],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
