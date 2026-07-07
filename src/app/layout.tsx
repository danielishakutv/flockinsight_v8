import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { PostHogProvider } from "@/components/analytics/posthog-provider";
import { MatomoProvider } from "@/components/analytics/matomo-provider";

const SITE_URL = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
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
        className={`${geistSans.variable} ${geistMono.variable} min-h-dvh antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <PostHogProvider>
            {children}
            <Toaster />
            <ServiceWorkerRegister />
            <MatomoProvider />
          </PostHogProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
