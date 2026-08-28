import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The verification tick that appears beside a verified church's name.
 *
 * No hooks and no client directive, so the same component works in a server
 * page (the public directory), inside a client table (superadmin), and in an
 * email-adjacent header alike. `title` is what a hovering mouse sees; the
 * sr-only span is what a screen reader hears — an icon alone would announce
 * nothing at all.
 */
export function VerifiedTick({
  className,
  label = "Verified church",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span className="inline-flex shrink-0 items-center" title={label}>
      <BadgeCheck
        aria-hidden
        className={cn("size-4 shrink-0 fill-sky-500 text-white", className)}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
