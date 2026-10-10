import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { PostHogProvider } from "@/components/analytics/posthog-provider";
import { MatomoProvider } from "@/components/analytics/matomo-provider";
import { I18nProvider } from "@/components/i18n-provider";
import { getI18n } from "@/lib/i18n/server";
import { ENTITY_SENTENCE_SHORT, metaKeywords } from "@/lib/seo/keywords";

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

/*
 * The site-wide default metadata, and the single most consequential edit in
 * this file's history.
 *
 * It used to read "Modern Church Management for Africa", with
 * `locale: "en_NG"` and a description naming only Nigeria. Every search engine
 * and every AI assistant reads those three fields first and takes them
 * literally — so a pastor in London asking any of them for church software was
 * being told, by us, that this product is for somebody else. We have paying
 * churches in Europe and East Africa; the metadata disqualified them.
 *
 * What replaces it says what the product IS before where it is from, which is
 * the order `ENTITY_SENTENCE` enforces and `keywords.test.ts` asserts. Africa
 * is not removed — it is moved to where it is a credential rather than a
 * fence: `alternateLocale`, `areaServed` in the landing page's Organization
 * schema, and the "built in Nigeria, which is why it works anywhere" section.
 *
 * `keywords` is a dead ranking signal for Google and has been for a decade. It
 * stays because AI crawlers do still read it, and it now comes from the
 * keyword map rather than being typed here, so it cannot drift from the pages
 * that actually target those phrases.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "FlockInsight — Church Management & Operations Platform",
    template: "%s · FlockInsight",
  },
  description: ENTITY_SENTENCE_SHORT,
  applicationName: "FlockInsight",
  keywords: metaKeywords(),
  authors: [{ name: "Toko Technologies", url: "https://tokotechnologies.com" }],
  creator: "Toko Technologies",
  publisher: "Toko Technologies",
  category: "Church Management Software",
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
    title: "FlockInsight — Church Management & Operations Platform",
    description: ENTITY_SENTENCE_SHORT,
    url: SITE_URL,
    /*
     * en_GB, not en_NG. Both are honest; only one of them fails to narrow the
     * audience. The locales we actually serve are listed beside it so a
     * crawler can see the site is multilingual before it finds the hreflang.
     */
    locale: "en_GB",
    alternateLocale: ["en_NG", "fr_FR", "pt_PT", "sw_KE", "ha_NG", "ig_NG", "yo_NG"],
  },
  twitter: {
    card: "summary_large_image",
    title: "FlockInsight — Church Management & Operations Platform",
    description: ENTITY_SENTENCE_SHORT,
  },
  robots: {
    index: true,
    follow: true,
    /*
     * `max-image-preview: large` is what lets Google show the OG card in
     * search and in Discover rather than a thumbnail. Without it the images
     * built in `lib/og/card.tsx` are shown small or not at all — the same
     * mistake as declaring a large Twitter card with no image.
     */
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
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
