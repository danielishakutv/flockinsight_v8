/**
 * Shared axis settings, so every chart clips or doesn't clip together.
 *
 * The charts all carried `margin={{ left: -16 }}` with a 40px YAxis. The
 * negative margin pulls the plot area left, which puts the leftmost part of
 * the tick labels outside the SVG and clips them — so "1500" rendered as
 * "500", and a column of ticks read "00, 50, 00, 50". It only shows once a
 * church's numbers reach three or four digits, which is why it survived: it
 * looks fine on a small demo and breaks on a real congregation.
 */

/** No negative left margin. The YAxis reserves its own room. */
export const CHART_MARGIN = { top: 10, right: 8, left: 0, bottom: 0 };

/**
 * Wide enough for a compact label ("12.5k") plus its gap, and no wider — the
 * reason for the negative margin was to reclaim whitespace, which this does
 * without cutting anything off.
 */
export const Y_AXIS_WIDTH = 44;

/**
 * Keep ticks short so the axis never needs to grow: 1200 → "1.2k". Below a
 * thousand the exact number is more useful than a rounded one, so it is left
 * alone.
 */
export function compactTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  const n = Math.abs(value);
  if (n < 1000) return String(value);
  if (n < 1_000_000) {
    const k = value / 1000;
    // 1.2k, but 12k rather than 12.0k.
    return `${Number.isInteger(k) || Math.abs(k) >= 10 ? Math.round(k) : k.toFixed(1)}k`;
  }
  const m = value / 1_000_000;
  return `${Math.abs(m) >= 10 ? Math.round(m) : m.toFixed(1)}m`;
}

/** The tick props every chart's YAxis uses. */
export const Y_AXIS_PROPS = {
  tickLine: false as const,
  axisLine: false as const,
  width: Y_AXIS_WIDTH,
  allowDecimals: false as const,
  tickFormatter: compactTick,
};
