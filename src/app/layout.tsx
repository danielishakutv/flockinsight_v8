import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { PostHogProvider } from "@/components/analytics/posthog-provider";
import { MatomoProvider } from "@/components/analytics/matomo-provider";
import { I18nProvider } from "@/components/i18n-provider";
import { getI18n } from "@/lib/i18n/server";

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

/*
 * The i18n provider lives here, at the root, and that is a change of mind.
 *
 * It used to be added only by the app, auth and meeting layouts, to keep the
 * marketing pages static. Two things made that wrong. Those pages are dynamic
 * now anyway — they read the language cookie to choose their own copy — so the
 * saving no longer exists. And every shared component was a trap: `useT()`
 * throws without a provider, so putting one into `ui/dialog.tsx` would have
 * crashed every dialog on the public site AND in /superadmin, neither of which
 * had a provider at all.
 *
 * One provider at the root means one hook, no trap, and the public pages and
 * the admin translate like everything else. The app and auth layouts still
 * nest their own, because those resolve a locale this one cannot see — the
 * signed-in user's saved preference and their church's default — and the
 * innermost provider wins.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, dict } = await getI18n();
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
            <I18nProvider locale={locale} dict={dict}>
              {children}
            </I18nProvider>
            <ServiceWorkerRegister />
            <MatomoProvider />
          </PostHogProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
