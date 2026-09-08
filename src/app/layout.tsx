import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { PostHogProvider } from "@/components/analytics/posthog-provider";
import { MatomoProvider } from "@/components/analytics/matomo-provider";

const SITE_URL = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

/**
 * One downloaded family, not two.
 *
 * Geist Mono was fetched on every page — another ~17KB of font before anything
 * rendered — for six places that show a code-ish snippet. On a 400kbps link
 * that is a second of the page's budget spent on a monospace font almost
 * nobody sees. The system mono stack in globals.css covers those instead.
 */
const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "FlockInsight — Modern Church Management for Africa",
    template: "%s · FlockInsight",
  },
  description:
    "Track attendance, members, groups, giving and follow-up — built for churches in Nigeria and across Africa. Fast, offline-ready and beautifully simple.",
  applicationName: "FlockInsight",
  keywords: [
    "church management software",
    "church app Nigeria",
    "church attendance app",
    "church giving tithe offering",
    "ChMS Africa",
    "member management",
    "FlockInsight",
  ],
  authors: [{ name: "Toko Technologies" }],
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "FlockInsight",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: "FlockInsight",
    title: "FlockInsight — Modern Church Management for Africa",
    description:
      "Attendance, members, groups, giving and follow-up for the modern African church.",
    url: SITE_URL,
    locale: "en_NG",
  },
  twitter: {
    card: "summary_large_image",
    title: "FlockInsight — Modern Church Management",
    description:
      "Attendance, members, groups, giving and follow-up for the modern African church.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0b17" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} min-h-dvh antialiased`}
      >
        {/*
          The Toaster is NOT here. sonner ships with every page that mounts it,
          and the marketing pages — which are the ones people open on bad
          connections — never raise a toast. It is added by the layouts and
          pages that actually need one.
        */}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <PostHogProvider>
            {children}
            <ServiceWorkerRegister />
            <MatomoProvider />
          </PostHogProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
