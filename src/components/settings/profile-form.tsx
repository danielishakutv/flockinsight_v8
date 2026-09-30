"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { updateChurchProfile } from "@/app/(app)/settings/actions";
import { CURRENCIES, DEFAULT_CURRENCY } from "@/lib/money";
import { COUNTRIES, NIGERIAN_STATES } from "@/lib/geo";
import { knownTimezones } from "@/lib/country-profile";
import { planName } from "@/lib/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/components/i18n-provider";

/*
 * Built from the country table, never hand-written.
 *
 * The hand-written version had ten entries and no Africa/Maputo, so a
 * Mozambican church saw Lagos selected and saving this page overwrote its
 * real timezone — moving every birthday and reminder by an hour, silently.
 */
const TIMEZONES = knownTimezones();

export function ProfileForm({
  initialName,
  initialTimezone,
  initialCurrency,
  initialCountry,
  initialState,
  plan,
  planPriceLabel,
}: {
  initialName: string;
  initialTimezone: string;
  initialCurrency: string;
  initialCountry: string;
  initialState: string | null;
  plan: string;
  planPriceLabel: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [timezone, setTimezone] = useState(
    // The church's own value wins, always. A value this list does not know is
    // a gap in the list, not a mistake by the church.
    initialTimezone || "Africa/Lagos",
  );
  const [currency, setCurrency] = useState(
    CURRENCIES.some((c) => c.code === initialCurrency)
      ? initialCurrency
      : DEFAULT_CURRENCY,
  );
  const [country, setCountry] = useState(initialCountry || "Nigeria");
  const [state, setState] = useState(initialState ?? "");

  /*
   * A Select cannot show a value that is not among its options — it renders
   * blank, and the next save writes the blank. So a timezone the table does
   * not know is added to the list rather than dropped from the church.
   */
  const timezoneOptions = TIMEZONES.includes(timezone)
    ? TIMEZONES
    : [timezone, ...TIMEZONES];

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateChurchProfile({
        name,
        timezone,
        currency,
        country,
        state: state || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("settings.churchProfileUpdated"));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t("settings.churchName")}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tz">{t("settings.timezone")}</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="tz" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timezoneOptions.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="currency">{t("settings.currency")}</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Used across the giving module.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">{t("settings.country")}</Label>
              <Select
                value={country}
                onValueChange={(v) => {
                  setCountry(v);
                  if (v !== "Nigeria") setState("");
                }}
              >
                <SelectTrigger id="country" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {country === "Nigeria" && (
            <div className="space-y-2">
              <Label htmlFor="state">{t("settings.stateRegion")}</Label>
              <Select value={state} onValueChange={setState}>
                <SelectTrigger id="state" className="w-full">
                  <SelectValue placeholder={t("settings.selectAState")} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {NIGERIAN_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button type="submit" size="lg" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Save changes
          </Button>

          {/* Current plan */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{t("settings.yourPlan")}</span>
              <Badge variant="secondary">{planName(plan)}</Badge>
              <span className="text-muted-foreground text-xs">
                {planPriceLabel}
              </span>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/billing">{t("settings.managePlan")}</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
