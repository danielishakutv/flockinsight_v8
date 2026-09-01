import type { NextConfig } from "next";

// Security headers applied to every response (boosts security posture / score).
// No CSP here to avoid breaking Next's inline runtime; the headers below are the
// high-value, low-risk ones (HSTS, anti-sniff, clickjacking, referrer, etc.).
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework/version.
  poweredByHeader: false,
  // Version-skew protection for rolling deploys: the deploy script sets this
  // to the commit being released, so a browser still holding the previous
  // build asks for its chunks with a stale ?dpl= and gets a hard navigation
  // instead of a missing-chunk crash. Empty locally, which disables it.
  deploymentId: process.env.DEPLOYMENT_ID,
  // Let Node resolve these at runtime instead of Turbopack bundling them.
  // Avoids deep ESM export-resolution errors in better-auth's optional
  // kysely adapter (which we don't use — we use the Drizzle adapter).
  serverExternalPackages: [
    "better-auth",
    "@better-auth/kysely-adapter",
    "kysely",
    // Heavy Node-side PDF renderer (fonts, fontkit) — let Node resolve it.
    "@react-pdf/renderer",
  ],
  // Smaller client bundles on slow networks: pull only the icons/helpers
  // actually used from these barrel packages instead of the whole library.
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns", "recharts"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
