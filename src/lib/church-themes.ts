// Public church-page colour themes — client-safe (no imports).
// Each church picks one; the public page sets these as CSS variables and the
// markup uses var-based utilities (bg-[var(--brand)], from-[var(--brand-from)]…).

export type ChurchTheme = {
  id: string;
  name: string;
  /** Main accent (buttons, links, highlights). */
  primary: string;
  /** Hero gradient endpoints. */
  from: string;
  to: string;
};

export const CHURCH_THEMES: ChurchTheme[] = [
  { id: "indigo", name: "Indigo", primary: "#5b3df5", from: "#6d28d9", to: "#4f46e5" },
  { id: "ocean", name: "Ocean", primary: "#0284c7", from: "#0ea5e9", to: "#2563eb" },
  { id: "forest", name: "Forest", primary: "#059669", from: "#10b981", to: "#0d9488" },
  { id: "sunset", name: "Sunset", primary: "#ea580c", from: "#f59e0b", to: "#e11d48" },
  { id: "royal", name: "Royal", primary: "#7c3aed", from: "#8b5cf6", to: "#d946ef" },
  { id: "berry", name: "Berry", primary: "#db2777", from: "#ec4899", to: "#be123c" },
  { id: "slate", name: "Slate", primary: "#334155", from: "#475569", to: "#1e293b" },
];

export const THEME_BY_ID: Record<string, ChurchTheme> = Object.fromEntries(
  CHURCH_THEMES.map((t) => [t.id, t]),
);

export const DEFAULT_THEME = CHURCH_THEMES[0];

export function getTheme(id: string | null | undefined): ChurchTheme {
  return (id && THEME_BY_ID[id]) || DEFAULT_THEME;
}

/** Inline CSS-variable style object for a theme wrapper. */
export function themeVars(theme: ChurchTheme): React.CSSProperties {
  return {
    ["--brand" as string]: theme.primary,
    ["--brand-from" as string]: theme.from,
    ["--brand-to" as string]: theme.to,
  } as React.CSSProperties;
}
