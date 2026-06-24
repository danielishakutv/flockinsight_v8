import { ImageResponse } from "next/og";

// Shared FlockInsight app-icon renderer (violet gradient + church glyph).
// Used by the PWA icon routes; generated at build time.
export function appIcon(size: number, maskable = false) {
  // Maskable icons need a safe zone — keep the glyph smaller with padding.
  const glyph = Math.round(size * (maskable ? 0.42 : 0.5));
  const radius = maskable ? 0 : Math.round(size * 0.22);
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
          background: "linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%)",
        }}
      >
        <svg
          width={glyph}
          height={glyph}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth={2.1}
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
    ),
    { width: size, height: size },
  );
}
