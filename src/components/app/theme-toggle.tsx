"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useMounted } from "@/lib/client-state";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/i18n-provider";

export function ThemeToggle() {
  const t = useT();
  const { setTheme, resolvedTheme } = useTheme();
  // The resolved theme is only known on the client; until then, show the
  // light-mode icon rather than guessing and flipping after hydration.
  const isDark = useMounted() && resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("app.toggleTheme")}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Moon className="size-5" /> : <Sun className="size-5" />}
    </Button>
  );
}
