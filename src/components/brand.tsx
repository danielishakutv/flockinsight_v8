import { Church } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "grid place-items-center rounded-xl bg-gradient-to-br from-primary to-violet-500 text-primary-foreground shadow-sm",
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
        Flock<span className="text-primary">Insight</span>
      </span>
    </div>
  );
}
