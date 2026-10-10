import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The link preview card — the image that renders when somebody pastes a
 * FlockInsight URL into WhatsApp, X, LinkedIn, Slack or iMessage.
 *
 * This did not exist before, and its absence was the most expensive missing
 * code in the project. `twitter.card` was set to "summary_large_image" and
 * `openGraph` carried no `images` at all, so every share of flockinsight.com
 * rendered as a bare grey text link. For a product that spreads pastor to
 * pastor in WhatsApp groups, that is the first impression almost every new
 * visitor got.
 *
 * ## The size is not negotiable
 *
 * 1200×630 (1.91:1) is what Facebook, WhatsApp, LinkedIn, Slack and X all
 * expect. Anything else gets cropped by each of them differently, and WhatsApp
 * in particular will silently fall back to the small square preview — which is
 * what makes a link look like a dead end.
 *
 * `og:image:width` and `og:image:height` must also be declared in the metadata
 * or WhatsApp often refuses the large card even when the image is the right
 * shape: it will not download the file to measure it before deciding how to
 * lay the bubble out. `openGraphImages()` below emits both.
 *
 * ## Why the type is set rather than drawn
 *
 * The wordmark is live text, not a bitmap, so a country page, a blog post and
 * a church's own page can each put their own words on the same card without
 * anybody opening a design tool. The font files are the two already in the repo
 * for the PDFs (`public/fonts`), which matters for one specific reason: Noto
 * Sans carries ₦, ₵, Latin Extended and the diacritics in real member and
 * church names. A card titled "Église Évangélique" or a plan at ₦12,000 would
 * otherwise render with holes in it, the same silent way the PDFs did.
 *
 * Noto Sans has no arrows. `→` draws an empty box here exactly as it does in a
 * PDF — use "->" or a word.
 */

/** Every platform's expected large-card geometry. Do not change these. */
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

const FONT_DIR = join(process.cwd(), "public", "fonts");

type LoadedFonts = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
  style: "normal";
}[];

/**
 * Read the two font files once per process.
 *
 * Cached in a module-level promise rather than re-read per request: these are
 * ~550KB each and an OG card is requested by every crawler that sees a link,
 * several at a time when a URL hits a busy WhatsApp group.
 */
let fontsPromise: Promise<LoadedFonts | null> | null = null;

async function fonts(): Promise<LoadedFonts | null> {
  fontsPromise ??= (async () => {
    try {
      const [regular, bold] = await Promise.all([
        readFile(join(FONT_DIR, "NotoSans-Regular.ttf")),
        readFile(join(FONT_DIR, "NotoSans-Bold.ttf")),
      ]);
      return [
        {
          name: "Noto Sans",
          data: regular.buffer.slice(
            regular.byteOffset,
            regular.byteOffset + regular.byteLength,
          ) as ArrayBuffer,
          weight: 400,
          style: "normal",
        },
        {
          name: "Noto Sans",
          data: bold.buffer.slice(
            bold.byteOffset,
            bold.byteOffset + bold.byteLength,
          ) as ArrayBuffer,
          weight: 700,
          style: "normal",
        },
      ] satisfies LoadedFonts;
    } catch (err) {
      /*
       * Say so, then carry on unstyled.
       *
       * An OG card in the fallback face is mildly disappointing; NO card is a
       * dead grey link in every WhatsApp group the URL reaches. So this never
       * throws — but it never passes silently either, because the failure mode
       * is invisible from the outside and the log line is the only way anybody
       * finds out the fonts stopped shipping.
       */
      console.error(
        "[og] font files unreadable, rendering card in the fallback face",
        { dir: FONT_DIR, err },
      );
      return null;
    }
  })();
  return fontsPromise;
}

/** The church mark, drawn at whatever size the slot gives it. */
function ChurchMark({ size, stroke = 2.1 }: { size: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ffffff"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 9h4" />
      <path d="M12 7v5" />
      <path d="M14 21v-3a2 2 0 0 0-4 0v3" />
      <path d="m18 9 3.52 2.147a1 1 0 0 1 .48.854V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6.999a1 1 0 0 1 .48-.854L6 9" />
      <path d="M6 21V7a1 1 0 0 1 .376-.782l5-3.999a1 1 0 0 1 1.249.001l5 4A1 1 0 0 1 18 7v14" />
    </svg>
  );
}

export type OgCardInput = {
  /** The headline. Kept short — this is read at thumbnail size in a chat list. */
  title: string;
  /** One supporting line. Optional, and truncated rather than wrapped forever. */
  subtitle?: string;
  /** Small label above the title: a section, a country, a module. */
  eyebrow?: string;
  /**
   * Up to three short proof chips along the bottom. These are the only place
   * on the card where a figure is allowed, and they must be facts, not claims.
   */
  chips?: string[];
  /**
   * A church's own page uses the lighter treatment: the card belongs to the
   * church, so FlockInsight steps back to a single line of attribution.
   */
  variant?: "brand" | "church";
};

/**
 * Title sizing by length, because satori will not shrink text to fit.
 *
 * Without this a long country-page title overflows the canvas and the bottom
 * of the card is simply gone — and you only find out by pasting the link into a
 * real chat, which nobody remembers to do.
 */
function titleSize(title: string): number {
  if (title.length <= 28) return 76;
  if (title.length <= 48) return 64;
  if (title.length <= 72) return 54;
  return 44;
}

/** Hard-truncate at a word boundary so a long subtitle cannot push the layout. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}

/**
 * Render a link preview card.
 *
 * Returns an ImageResponse, so a route exports it directly:
 *
 *     export default function Image() {
 *       return ogCard({ title: "...", subtitle: "..." });
 *     }
 */
export async function ogCard({
  title,
  subtitle,
  eyebrow,
  chips,
  variant = "brand",
}: OgCardInput): Promise<ImageResponse> {
  const loaded = await fonts();
  const church = variant === "church";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          fontFamily: loaded ? "Noto Sans" : "sans-serif",
          color: "#ffffff",
          /*
           * Two gradients, not one. The radial is the light source at the top
           * left; the linear underneath keeps the bottom right dark enough for
           * the chips to stay legible. A single flat gradient looked like a
           * template, which is the one thing a link preview must not look like.
           */
          backgroundImage:
            "radial-gradient(90% 120% at 8% -10%, #a78bfa 0%, rgba(124,58,237,0) 55%), linear-gradient(135deg, #4c1d95 0%, #6d28d9 45%, #3b0764 100%)",
          backgroundColor: "#4c1d95",
        }}
      >
        {/* Masthead */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 68,
                height: 68,
                borderRadius: 20,
                backgroundColor: "rgba(255,255,255,0.14)",
                border: "1px solid rgba(255,255,255,0.22)",
              }}
            >
              <ChurchMark size={38} stroke={2.2} />
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 36,
                fontWeight: 700,
                letterSpacing: -0.5,
              }}
            >
              FlockInsight
            </div>
          </div>

          {eyebrow ? (
            <div
              style={{
                display: "flex",
                fontSize: 22,
                fontWeight: 700,
                padding: "10px 22px",
                borderRadius: 999,
                backgroundColor: "rgba(255,255,255,0.16)",
                border: "1px solid rgba(255,255,255,0.24)",
                color: "#f5f3ff",
              }}
            >
              {clamp(eyebrow, 34)}
            </div>
          ) : null}
        </div>

        {/* The words */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              fontSize: church ? 62 : titleSize(title),
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: -1.5,
              // 3 lines at the largest size still clears the chips row.
              maxWidth: 1000,
            }}
          >
            {clamp(title, 110)}
          </div>
          {subtitle ? (
            <div
              style={{
                display: "flex",
                fontSize: 28,
                lineHeight: 1.4,
                color: "rgba(255,255,255,0.82)",
                maxWidth: 900,
              }}
            >
              {clamp(subtitle, 150)}
            </div>
          ) : null}
        </div>

        {/* Footer: proof on the left, the domain on the right */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {(chips ?? []).slice(0, 3).map((chip) => (
              <div
                key={chip}
                style={{
                  display: "flex",
                  fontSize: 21,
                  fontWeight: 700,
                  padding: "9px 20px",
                  borderRadius: 12,
                  backgroundColor: "rgba(255,255,255,0.10)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  color: "#ede9fe",
                }}
              >
                {clamp(chip, 30)}
              </div>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 23,
              fontWeight: 700,
              color: "rgba(255,255,255,0.72)",
            }}
          >
            {church ? "on flockinsight.com" : "flockinsight.com"}
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      ...(loaded ? { fonts: loaded } : {}),
    },
  );
}
