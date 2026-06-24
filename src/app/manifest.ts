import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FlockInsight — Church Management",
    short_name: "FlockInsight",
    description:
      "Attendance, members, groups, giving and follow-up for the modern church.",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#0f0b17",
    theme_color: "#6d28d9",
    categories: ["productivity", "business", "lifestyle"],
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-512-maskable",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Record attendance",
        short_name: "Record",
        url: "/attendance/record",
      },
      { name: "Record giving", short_name: "Giving", url: "/giving" },
      { name: "Members", short_name: "Members", url: "/members" },
    ],
  };
}
