"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useMounted } from "@/lib/client-state";

/** A floating light/dark toggle for public pages (visitors can switch). */
export function PublicThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label="Toggle light or dark mode"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="fixed right-3 top-3 z-50 grid size-10 place-items-center rounded-full border border-white/40 bg-black/25 text-white shadow backdrop-blur transition hover:bg-black/40"
    >
      {mounted && isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}
