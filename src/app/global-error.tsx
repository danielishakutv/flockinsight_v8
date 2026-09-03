"use client";

import { useEffect } from "react";

/**
 * Last resort: the root layout itself failed, so this replaces the whole
 * document and cannot rely on anything above it.
 *
 * Styles are inline on purpose. This boundary stands in for the root layout,
 * which is where the stylesheet is loaded, so a page that leans on Tailwind
 * here risks rendering as unstyled text at exactly the moment we most want it
 * to look deliberate.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "1.5rem",
          background: "#f8fafc",
          color: "#0f172a",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <main style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0 }}>
            FlockInsight hit an unexpected error
          </h1>
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: "#475569",
            }}
          >
            Your church&apos;s data is safe — this is a display problem, not a
            data one. Reloading usually clears it.
          </p>
          {error.digest && (
            <p
              style={{
                marginTop: "0.5rem",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.75rem",
                color: "#64748b",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.25rem",
              cursor: "pointer",
              borderRadius: "0.5rem",
              border: "none",
              background: "#0f172a",
              color: "#fff",
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
