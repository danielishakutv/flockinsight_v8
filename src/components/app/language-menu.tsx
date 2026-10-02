"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Languages } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES } from "@/lib/i18n/locales";
import { useLocale, useT } from "@/components/i18n-provider";
import { switchLanguage } from "@/app/(app)/settings/language/actions";

/**
 * Switching language — its own control in the top bar.
 *
 * It used to be eight items stapled to the bottom of the account menu, which
 * made opening that menu to sign out or change the theme a scroll past a list
 * of languages nobody was looking for. One icon costs nothing until it is
 * wanted, and the languages are then the whole of what it shows.
 *
 * It stays out of Settings, though, and that is the original reasoning and
 * still right: the person who needs this is not the administrator who set the
 * church up, it is somebody opening the app for the first time — and they are
 * not going to go hunting under Settings in a language they cannot read. Two
 * taps from anywhere, and every option written in its own language, because a
 * list that says "Hausa" to someone who reads Hausa is a list in the wrong
 * language.
 */
export function LanguageMenu({ className }: { className?: string }) {
  const t = useT();
  const current = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const active = LOCALES.find((l) => l.code === current);

  const pick = (code: string) => {
    if (code === current) return;
    startTransition(async () => {
      const res = await switchLanguage(code);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          disabled={pending}
          /*
           * The label names the CURRENT language as well as the action, so a
           * screen reader user knows what it is set to without opening it —
           * the one thing the icon alone cannot say.
           */
          aria-label={`${t("nav.language")}: ${active?.native ?? current}`}
        >
          <Languages className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-muted-foreground flex items-center gap-2 text-xs font-normal">
          <Languages className="size-3.5" aria-hidden />
          {t("nav.language")}
        </DropdownMenuLabel>
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
            {!l.reviewed && (
              <span className="text-muted-foreground ml-auto text-[10px] font-bold uppercase">
                {t("settings.beta")}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
