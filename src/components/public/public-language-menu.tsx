"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Languages } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES, LOCALE_COOKIE, DEFAULT_LOCALE } from "@/lib/i18n/locales";
import { useMounted } from "@/lib/client-state";
import { switchLanguage } from "@/app/(app)/settings/language/actions";
import { useT } from "@/components/i18n-provider";

/**
 * Choosing a language before you have an account.
 *
 * The in-app picker is behind a sign-in, which is exactly backwards: somebody
 * deciding whether this software is for their church is reading the marketing
 * site, and if that site only speaks English they have already decided. The
 * underlying action writes a cookie and only touches an account when there is
 * one, so it works perfectly well for a stranger.
 *
 * Every option is written in its own language. A list that says "French" to
 * somebody who cannot read English is a list they cannot use.
 *
 * The current locale is read from the cookie HERE rather than passed down from
 * the server, and that is the whole reason this component exists separately
 * from the in-app one. Marketing pages are statically rendered; asking the
 * server for the locale would make every one of them dynamic, and those are
 * precisely the pages somebody opens on a bad connection to decide whether
 * this software is worth their time.
 */
export function PublicLanguageMenu({ className }: { className?: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Null until hydrated, so the static markup and the first client render
  // agree; the trigger simply shows the globe until then.
  const mounted = useMounted();
  const current = mounted ? readLocaleCookie() : null;

  const pick = (code: string) => {
    if (code === current) return;
    startTransition(async () => {
      await switchLanguage(code);
      router.refresh();
    });
  };

  const active = LOCALES.find((l) => l.code === current);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={className}
        aria-label={t("public.chooseALanguage")}
        disabled={pending}
      >
        <span className="text-muted-foreground hover:text-foreground inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition-colors sm:h-9">
          <Languages aria-hidden className="size-4" />
          <span className="hidden sm:inline">{active?.native ?? "Language"}</span>
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-muted-foreground flex items-center gap-2 text-xs font-normal">
          <Languages className="size-3.5" />
          Language
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            disabled={pending}
            onClick={() => pick(l.code)}
            lang={l.code}
          >
            {l.code === current ? (
              <Check className="size-4" />
            ) : (
              <span className="size-4" aria-hidden />
            )}
            {l.native}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The chosen locale, or null when nothing has been chosen in this browser. */
function readLocaleCookie(): string | null {
  try {
    const hit = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${LOCALE_COOKIE}=`));
    const value = hit?.slice(LOCALE_COOKIE.length + 1);
    if (!value || value === "auto") return DEFAULT_LOCALE;
    return LOCALES.some((l) => l.code === value) ? value : DEFAULT_LOCALE;
  } catch {
    // Cookies blocked. The menu still switches; it just cannot show a tick.
    return null;
  }
}
