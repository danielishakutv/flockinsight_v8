"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { updateChurchProfile } from "@/app/(app)/settings/actions";
import { CURRENCIES, DEFAULT_CURRENCY } from "@/lib/money";
import { COUNTRIES, NIGERIAN_STATES } from "@/lib/geo";
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

const TIMEZONES = [
  "Africa/Lagos",
  "Africa/Accra",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Africa/Cairo",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "UTC",
];

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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [timezone, setTimezone] = useState(
    TIMEZONES.includes(initialTimezone) ? initialTimezone : "Africa/Lagos",
  );
  const [currency, setCurrency] = useState(
    CURRENCIES.some((c) => c.code === initialCurrency)
      ? initialCurrency
      : DEFAULT_CURRENCY,
  );
  const [country, setCountry] = useState(initialCountry || "Nigeria");
  const [state, setState] = useState(initialState ?? "");

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
      toast.success("Church profile updated");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Church name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tz">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="tz" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
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
              <Label htmlFor="country">Country</Label>
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
              <Label htmlFor="state">State / Region</Label>
              <Select value={state} onValueChange={setState}>
                <SelectTrigger id="state" className="w-full">
                  <SelectValue placeholder="Select a state" />
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
              <span className="text-sm font-medium">Your plan</span>
              <Badge variant="secondary">{planName(plan)}</Badge>
              <span className="text-muted-foreground text-xs">
                {planPriceLabel}
              </span>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/billing">Manage plan</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
