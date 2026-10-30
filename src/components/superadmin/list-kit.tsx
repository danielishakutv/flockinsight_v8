"use client";

/**
 * The pieces every admin list is built from, so they all behave the same on a
 * phone.
 *
 * The lists used to put the search box, the sort pills and the filters on one
 * wrapping row, and each item's name on the same row as its buttons. On a
 * 390px screen that left the search box four letters wide and the church's
 * name squeezed to nothing beside "Log in · Suspend · Delete". The rule here
 * is the one a phone needs: the name gets its own line, search gets the whole
 * width, and the actions sit together underneath, with anything rare or
 * destructive behind a "more" menu instead of a fourth button.
 */

import type { ReactNode } from "react";
import { MoreHorizontal, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

/** A search box that takes the full width on a phone. */
export function AdminSearch({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn("relative w-full min-w-0 sm:max-w-md", className)}>
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-9"
      />
    </div>
  );
}

/**
 * "Sort by" as one compact native select rather than a row of pills: four
 * pills next to a search box is what squeezed the box, and a native picker is
 * the one a phone already knows how to show.
 */
export function AdminSort<K extends string>({
  value,
  options,
  onChange,
}: {
  value: K;
  options: readonly { key: K; label: string }[];
  onChange: (value: K) => void;
}) {
  return (
    <label className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs font-semibold">
      Sort by
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as K)}
        className="border-input bg-background text-foreground focus-visible:ring-ring/50 h-9 rounded-lg border px-2.5 text-sm font-medium focus-visible:ring-[3px] focus-visible:outline-none"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Filter chips on one line that scrolls sideways, never wrapping into a block. */
export function AdminChips<K extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: K;
  options: readonly { key: K; label: string; count?: number }[];
  onChange: (value: K) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition",
            value === o.key
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span className="tabular-nums opacity-70">{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * The action bar under an item: the common actions share the width on a
 * phone, sit at their natural size on the right from `sm`, and the rest go in
 * `more`.
 */
export function RowActions({
  children,
  more,
  moreLabel,
  className,
}: {
  children?: ReactNode;
  /** DropdownMenuItems. Omit for no menu. */
  more?: ReactNode;
  moreLabel: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t px-3 py-2.5 sm:justify-end sm:px-4 [&>*:not([data-more])]:flex-1 sm:[&>*:not([data-more])]:flex-none",
        className,
      )}
    >
      {children}
      {more && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              data-more
              variant="outline"
              size="sm"
              className="shrink-0 px-2.5"
              aria-label={moreLabel}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            {more}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
