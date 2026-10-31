import { Church } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        // White, not primary-foreground: in dark mode that token is near-black,
        // which drew the church as a dark smudge on the purple tile.
        "grid place-items-center rounded-xl bg-gradient-to-br from-primary to-violet-500 text-white shadow-sm",
        className,
      )}
    >
      <Church className="size-1/2" strokeWidth={2.4} />
    </div>
  );
}

export function Wordmark({
  className,
  showLogo = true,
  logoClassName,
  textClassName,
}: {
  className?: string;
  showLogo?: boolean;
  logoClassName?: string;
  /**
   * Classes for the name itself, so a cramped header can drop it and keep the
   * mark. The public header does this below 400px: the name is ~133px, which
   * is the difference between the bar fitting a 320px phone and the whole page
   * scrolling sideways.
   */
  textClassName?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {showLogo && <Logo className={cn("size-9", logoClassName)} />}
      <span className={cn("text-xl font-extrabold tracking-tight", textClassName)}>
        {/* A lighter violet in dark mode: the primary shade sits too close to
            a dark page for a word this size to read. */}
        Flock<span className="text-primary dark:text-violet-300">Insight</span>
      </span>
    </div>
  );
}
