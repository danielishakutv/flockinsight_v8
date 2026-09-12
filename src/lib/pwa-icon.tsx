import { ImageResponse } from "next/og";

/**
 * The FlockInsight app icon: the church mark centred on the brand violet.
 *
 * No wordmark on the icon itself. Every platform prints "FlockInsight" beneath
 * it already, and type set inside a 48px launcher tile is a grey smudge — the
 * name comes from the manifest, the icon carries the mark.
 *
 * Two shapes, because they are shown differently:
 *
 * - "any" is used as given, so it rounds its own corners.
 * - "maskable" is cropped by the platform to whatever shape it likes — a
 *   circle on Pixel, a squircle on Samsung — so it bleeds to the edges and
 *   keeps the mark inside the 80% safe zone. Sharing one size between the two
 *   is what produces the clipped-logo look on some phones and not others.
 */
export function appIcon(size: number, maskable = false) {
  // The safe zone is a circle of 80% diameter; 40% of the canvas keeps the
  // mark clear of any crop a launcher applies.
  const glyph = Math.round(size * (maskable ? 0.4 : 0.52));
  const radius = maskable ? 0 : Math.round(size * 0.22);
  // In viewBox units, so it scales with the mark and needs no pixel maths.
  // A shade heavier on the maskable one, which is drawn smaller.
  const stroke = maskable ? 2.3 : 2.1;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius,
          // The highlight sits above the mark's own centre so the tile reads as
          // lit from above, the way every other icon on the home screen does.
          backgroundImage:
            "radial-gradient(120% 100% at 30% 0%, #a78bfa 0%, #7c3aed 45%, #5b21b6 100%)",
          backgroundColor: "#6d28d9",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // Optical centring: the church mark is bottom-heavy, so sitting it
            // on the true centre makes it look low. A nudge up fixes it.
            transform: `translateY(-${Math.round(size * 0.012)}px)`,
          }}
        >
          <svg
            width={glyph}
            height={glyph}
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
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
