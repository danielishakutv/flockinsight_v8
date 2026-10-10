import { cn } from "@/lib/utils";

/**
 * A section's eyebrow, heading and lead-in, set the same way every time.
 *
 * The landing page had this block copy-pasted seven times with the sizes
 * drifting by a step each time, which is the specific thing that makes a page
 * read as assembled rather than designed. One component, one rhythm.
 */
export function SectionHeading({
  eyebrow,
  title,
  intro,
  align = "center",
  id,
  className,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  align?: "center" | "left";
  /** Anchors the H2 itself, so a jump link lands on the heading not above it. */
  id?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" ? "mx-auto text-center" : "",
        className,
      )}
    >
      {eyebrow ? (
        <p className="text-primary text-sm font-bold tracking-wider uppercase">
          {eyebrow}
        </p>
      ) : null}
      <h2
        id={id}
        /*
         * `scroll-mt` so an in-page jump does not land the heading under the
         * sticky header. The header is h-16, plus a little air.
         */
        className="mt-2 scroll-mt-24 text-3xl font-extrabold tracking-tight text-balance lg:text-4xl"
      >
        {title}
      </h2>
      {intro ? (
        <p className="text-muted-foreground mt-4 text-lg text-pretty">{intro}</p>
      ) : null}
    </div>
  );
}
