import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
