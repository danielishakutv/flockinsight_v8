"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Radix selects can't hold an empty value, so "all countries" gets a sentinel. */
const ANY_COUNTRY = "__any__";

export function DirectorySearch({
  countries,
  initialQ,
  initialCountry,
  initialDenom,
  near,
}: {
  countries: string[];
  initialQ: string;
  initialCountry: string;
  initialDenom: string;
  near: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(initialQ);
  const [country, setCountry] = useState(initialCountry);
  const [denom, setDenom] = useState(initialDenom);
  const [locating, setLocating] = useState(false);

  function apply(extra?: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    const setp = (k: string, v: string | null) => {
      if (v) sp.set(k, v);
      else sp.delete(k);
    };
    setp("q", q.trim() || null);
    setp("country", country || null);
    setp("denom", denom.trim() || null);
    if (extra) for (const [k, v] of Object.entries(extra)) setp(k, v);
    router.push(`/churches?${sp.toString()}`);
  }

  function nearMe() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        apply({
          near: `${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`,
        });
      },
      () => setLocating(false),
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      className="space-y-3"
    >
      <div className="relative">
        <Search className="text-muted-foreground absolute left-3 top-1/2 size-5 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, denomination, city…"
          className="bg-background h-12 w-full rounded-xl border pl-11 pr-4 text-base shadow-sm outline-none focus:ring-2 focus:ring-violet-500"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Select
          value={country || ANY_COUNTRY}
          onValueChange={(v) => setCountry(v === ANY_COUNTRY ? "" : v)}
        >
          <SelectTrigger
            size="sm"
            aria-label="Country"
            className="bg-background h-10 w-auto min-w-40 rounded-lg text-sm"
          >
            <SelectValue placeholder="All countries" />
          </SelectTrigger>
          <SelectContent searchPlaceholder="Search countries…">
            <SelectItem value={ANY_COUNTRY}>All countries</SelectItem>
            {countries.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          value={denom}
          onChange={(e) => setDenom(e.target.value)}
          placeholder="Denomination / type"
          className="bg-background h-10 rounded-lg border px-3 text-sm"
        />
        <button
          type="submit"
          className="h-10 rounded-lg bg-violet-600 px-4 text-sm font-bold text-white transition hover:bg-violet-700"
        >
          Search
        </button>
        <button
          type="button"
          onClick={nearMe}
          className={
            "inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition hover:bg-muted " +
            (near ? "border-violet-500 text-violet-600" : "")
          }
        >
          {locating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MapPin className="size-4" />
          )}
          {near ? "Near you" : "Near me"}
        </button>
      </div>
    </form>
  );
}
