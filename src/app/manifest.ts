import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Shown under the icon on a home screen. Long names are truncated there,
    // so short_name carries the brand and name carries the explanation.
    name: "FlockInsight — Everything your ministry needs",
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
    // Android builds its launch screen from these three: the icon, the name,
    // and this colour. Matching the in-app splash makes the handover from the
    // system screen to ours invisible.
    launch_handler: { client_mode: "navigate-existing" },
    prefer_related_applications: false,
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
