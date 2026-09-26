"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Languages } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { LOCALES } from "@/lib/i18n/locales";
import { useLocale, useT } from "@/components/i18n-provider";
import { switchLanguage } from "@/app/(app)/settings/language/actions";

/**
 * Switching language from the account menu.
 *
 * Buried in Settings it would be found by the administrator who set the church
 * up and by nobody else. The person who actually needs it is the usher opening
 * the app for the first time on somebody else's recommendation, and they are
 * not going to go looking under Settings in a language they cannot read — so it
 * sits two taps from anywhere, and every option is written in its own language.
 */
export function LanguageMenu() {
  const t = useT();
  const current = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

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
    <>
      <DropdownMenuLabel className="text-muted-foreground flex items-center gap-2 text-xs font-normal">
        <Languages className="size-3.5" />
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
    </>
  );
}
