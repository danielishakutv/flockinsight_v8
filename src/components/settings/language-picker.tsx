"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Globe, Languages, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LOCALES, type LocaleCode } from "@/lib/i18n/locales";
import { useT } from "@/components/i18n-provider";
import {
  setChurchLanguage,
  setMyLanguage,
} from "@/app/(app)/settings/language/actions";
import { cn } from "@/lib/utils";

type Choice = LocaleCode | "auto";

/**
 * Choosing a language.
 *
 * Every option is written in its own language, because somebody looking for
 * Yoruba is looking for "Yorùbá", not for the word "Yoruba" in an interface they
 * cannot read yet. The English name sits underneath for an administrator setting
 * it on somebody else's behalf.
 *
 * The unreviewed languages are marked and say why, with an invitation to report
 * what reads wrong. Presenting a rough translation as finished work would be
 * the dishonest option; hiding it from the people it helps would be the
 * cowardly one.
 */
export function LanguagePicker({
  mine,
  churchDefault,
  canManageChurch,
  churchName,
}: {
  mine: Choice;
  churchDefault: Choice;
  canManageChurch: boolean;
  churchName: string;
}) {
  const t = useT();
  const router = useRouter();
  const [myChoice, setMyChoice] = useState<Choice>(mine);
  const [orgChoice, setOrgChoice] = useState<Choice>(churchDefault);
  const [pending, startTransition] = useTransition();

  const pickMine = (code: Choice) => {
    const previous = myChoice;
    setMyChoice(code);
    startTransition(async () => {
      const res = await setMyLanguage(code);
      if (!res.ok) {
        setMyChoice(previous);
        toast.error(res.error);
        return;
      }
      toast.success(t("settings.languageChanged"));
      // The whole shell is in the old language until the server re-renders it.
      router.refresh();
    });
  };

  const pickChurch = (code: Choice) => {
    const previous = orgChoice;
    setOrgChoice(code);
    startTransition(async () => {
      const res = await setChurchLanguage(code);
      if (!res.ok) {
        setOrgChoice(previous);
        toast.error(res.error);
        return;
      }
      toast.success(t("common.saved"));
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Languages className="size-4" />
            {t("settings.yourLanguage")}
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            {t("settings.yourLanguageHint")}
          </p>
        </CardHeader>
        <CardContent>
          <LanguageGrid
            value={myChoice}
            onPick={pickMine}
            pending={pending}
            autoLabel={t("settings.followDevice")}
            autoHint={t("settings.followDeviceHint")}
            betaLabel={t("settings.beta")}
          />
          <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
            {t("settings.betaHint")}
          </p>
        </CardContent>
      </Card>

      {canManageChurch && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="size-4" />
              {t("settings.churchDefault")}
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              {t("settings.churchDefaultHint")}
            </p>
          </CardHeader>
          <CardContent>
            <LanguageGrid
              value={orgChoice}
              onPick={pickChurch}
              pending={pending}
              autoLabel={churchName}
              autoHint={t("settings.followDeviceHint")}
              betaLabel={t("settings.beta")}
              autoIsDefault
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LanguageGrid({
  value,
  onPick,
  pending,
  autoLabel,
  autoHint,
  betaLabel,
  autoIsDefault,
}: {
  value: Choice;
  onPick: (code: Choice) => void;
  pending: boolean;
  autoLabel: string;
  autoHint: string;
  betaLabel: string;
  /** In the church card, "auto" means "let each person's device decide". */
  autoIsDefault?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {LOCALES.map((l) => {
        const selected = value === l.code;
        return (
          <button
            key={l.code}
            type="button"
            disabled={pending}
            onClick={() => onPick(l.code)}
            aria-pressed={selected}
            lang={l.code}
            className={cn(
              "flex items-center gap-3 rounded-xl border p-3 text-left transition disabled:opacity-60",
              selected
                ? "border-primary bg-primary/5 ring-primary/30 ring-2"
                : "hover:bg-muted/50",
            )}
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold uppercase",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {selected ? <Check className="size-4" /> : l.code}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="truncate font-semibold">{l.native}</span>
                {!l.reviewed && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 uppercase dark:text-amber-300">
                    {betaLabel}
                  </span>
                )}
              </span>
              {l.native !== l.name && (
                <span className="text-muted-foreground block truncate text-xs">
                  {l.name}
                </span>
              )}
            </span>
            {pending && selected && (
              <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
            )}
          </button>
        );
      })}

      <button
        type="button"
        disabled={pending}
        onClick={() => onPick("auto")}
        aria-pressed={value === "auto"}
        className={cn(
          "flex items-center gap-3 rounded-xl border border-dashed p-3 text-left transition disabled:opacity-60 sm:col-span-2",
          value === "auto"
            ? "border-primary bg-primary/5 ring-primary/30 ring-2"
            : "hover:bg-muted/50",
        )}
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            value === "auto"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {value === "auto" ? <Check className="size-4" /> : <Globe className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">
            {autoIsDefault ? `${autoLabel} — no default` : autoLabel}
          </span>
          <span className="text-muted-foreground block text-xs">{autoHint}</span>
        </span>
      </button>
    </div>
  );
}
