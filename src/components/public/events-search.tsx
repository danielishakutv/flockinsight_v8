"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";

export function EventsSearch({
  initialQ,
  near,
}: {
  initialQ: string;
  near: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(initialQ);
  const [locating, setLocating] = useState(false);

  function apply(extra?: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    if (q.trim()) sp.set("q", q.trim());
    else sp.delete("q");
    if (extra)
      for (const [k, v] of Object.entries(extra)) {
        if (v) sp.set(k, v);
        else sp.delete(k);
      }
    router.push(`/events?${sp.toString()}`);
  }

  function nearMe() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        apply({ near: `${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}` });
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
      className="flex flex-wrap gap-2"
    >
      <div className="relative min-w-[12rem] flex-1">
        <Search className="text-muted-foreground absolute left-3 top-1/2 size-5 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search events, churches, venues…"
          className="bg-background h-12 w-full rounded-xl border pl-11 pr-4 text-base shadow-sm outline-none focus:ring-2 focus:ring-violet-500"
        />
      </div>
      <button
        type="submit"
        className="h-12 rounded-xl bg-violet-600 px-5 text-sm font-bold text-white transition hover:bg-violet-700"
      >
        Search
      </button>
      <button
        type="button"
        onClick={nearMe}
        className={
          "inline-flex h-12 items-center gap-1.5 rounded-xl border px-4 text-sm font-semibold transition hover:bg-muted " +
          (near ? "border-violet-500 text-violet-600" : "")
        }
      >
        {locating ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
        {near ? "Near you" : "Near me"}
      </button>
    </form>
  );
}
