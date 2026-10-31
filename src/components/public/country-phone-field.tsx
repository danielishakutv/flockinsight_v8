"use client";

import { useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import {
  DIAL_COUNTRIES,
  dialCountry,
  DEFAULT_DIAL_ISO2,
  flagOf,
  matchesCountry,
} from "@/lib/dial-codes";
import { internationalPhone } from "@/lib/phone-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * A country, and a phone number that always carries that country's code.
 *
 * The country is chosen first and the code is drawn in front of the number, so
 * nobody has to know or type it — a pastor types the number the way they say
 * it, with or without the leading zero, and what is stored is international.
 * Somebody who pastes a number that already starts with "+" is believed over
 * the dropdown: they have told us outright.
 *
 * The list is searchable by name, by two-letter code and by the digits of the
 * code itself, because two hundred countries in a native <select> is a scroll
 * nobody finishes on a phone. It is a portal (Radix Popover) so it is never
 * clipped by a card or captured by a blurred header.
 */
export function CountryPhoneField({
  country,
  onCountryChange,
  phone,
  onPhoneChange,
  phoneLabel,
  idPrefix = "cp",
}: {
  /** ISO-3166 alpha-2. */
  country: string;
  onCountryChange: (iso2: string) => void;
  /** What the person typed, unprefixed. */
  phone: string;
  onPhoneChange: (value: string) => void;
  phoneLabel: string;
  idPrefix?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = dialCountry(country) ?? dialCountry(DEFAULT_DIAL_ISO2)!;
  const results = useMemo(
    () => DIAL_COUNTRIES.filter((c) => matchesCountry(c, query)),
    [query],
  );
  const full = phone.trim() ? internationalPhone(phone, selected.dial) : null;

  function choose(iso2: string) {
    onCountryChange(iso2);
    setOpen(false);
    setQuery("");
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next =
        e.key === "ArrowDown"
          ? Math.min(active + 1, results.length - 1)
          : Math.max(active - 1, 0);
      setActive(next);
      listRef.current
        ?.querySelector<HTMLElement>(`[data-index="${next}"]`)
        ?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[active];
      if (pick) choose(pick.iso2);
    }
  }

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-country`}>Country</Label>
        <Popover.Root
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setQuery("");
            setActive(0);
          }}
        >
          <Popover.Trigger asChild>
            <button
              id={`${idPrefix}-country`}
              type="button"
              role="combobox"
              aria-expanded={open}
              aria-controls={`${idPrefix}-country-list`}
              className="border-input bg-background focus-visible:ring-ring/50 flex h-11 w-full items-center gap-2 rounded-lg border px-3 text-left text-base focus-visible:ring-[3px] focus-visible:outline-none sm:h-10 md:text-sm"
            >
              <span aria-hidden>{flagOf(selected.iso2)}</span>
              <span className="min-w-0 flex-1 truncate">{selected.name}</span>
              <span className="text-muted-foreground tabular-nums">+{selected.dial}</span>
              <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="bg-popover text-popover-foreground z-50 w-[var(--radix-popover-trigger-width)] min-w-[16rem] overflow-hidden rounded-lg border shadow-lg"
            >
              <div className="flex items-center gap-2 border-b px-3">
                <Search className="text-muted-foreground size-4 shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onSearchKey}
                  placeholder="Search country or code"
                  aria-label="Search countries"
                  className="h-10 w-full bg-transparent text-base outline-none md:text-sm"
                />
              </div>
              <ul
                ref={listRef}
                id={`${idPrefix}-country-list`}
                role="listbox"
                className="max-h-64 overflow-y-auto overscroll-contain py-1"
              >
                {results.length === 0 ? (
                  <li className="text-muted-foreground px-3 py-2 text-sm">
                    No country matches &ldquo;{query}&rdquo;.
                  </li>
                ) : (
                  results.map((c, i) => (
                    <li
                      key={c.iso2}
                      data-index={i}
                      role="option"
                      aria-selected={c.iso2 === selected.iso2}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(c.iso2)}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm",
                        i === active && "bg-accent text-accent-foreground",
                      )}
                    >
                      <span aria-hidden>{flagOf(c.iso2)}</span>
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="text-muted-foreground tabular-nums">+{c.dial}</span>
                      {c.iso2 === selected.iso2 && <Check className="size-4" />}
                    </li>
                  ))
                )}
              </ul>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-phone`}>{phoneLabel}</Label>
        <div className="flex">
          <span className="border-input bg-muted text-muted-foreground inline-flex shrink-0 items-center rounded-l-lg border border-r-0 px-3 text-sm tabular-nums">
            +{selected.dial}
          </span>
          <Input
            id={`${idPrefix}-phone`}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder="Phone number"
            className="rounded-l-none"
            required
          />
        </div>
        {/*
          Said while they type rather than after they submit: the number we
          will actually keep, or why we can't keep it yet.
        */}
        {phone.trim() ? (
          full ? (
            <p className="text-muted-foreground text-xs">We&apos;ll save +{full}</p>
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              That isn&apos;t a complete {selected.name} number yet.
            </p>
          )
        ) : null}
      </div>
    </>
  );
}
