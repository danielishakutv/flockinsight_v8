import type { ReactNode } from "react";
import { Info } from "lucide-react";
import {
  readability,
  readabilityNote,
  sampleLabel,
  type MetricKind,
  type Sample,
} from "@/lib/thin-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A panel that cannot show a number without saying where it came from.
 *
 * `sample` and `kind` are required, so a panel physically cannot render a body
 * without declaring what it is drawn from. That is the whole design: if the
 * honest label were something an author chose to add, roughly half of them
 * would be added — and the ones that were not would be exactly the panels
 * written in six months by somebody who assumed the data had grown up.
 *
 * Built on `<Card>` rather than a bare div so it inherits the `[data-admin]`
 * density rules, which key on `data-slot="card"`.
 */
export function Panel({
  title,
  sample,
  kind,
  action,
  children,
  className,
}: {
  title: string;
  sample: Sample;
  kind: MetricKind;
  /** A link or control for the card header. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const verdict = readability(sample, kind);
  const note = readabilityNote(verdict, kind);

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          <p className="text-muted-foreground mt-1 text-xs wrap-anywhere">
            {sampleLabel(sample)}
          </p>
        </div>
        {action}
      </CardHeader>

      <CardContent>
        {verdict === "too_thin" ? (
          <NotEnoughData note={note}>{children}</NotEnoughData>
        ) : (
          <>
            {verdict === "thin" && (
              <p className="text-muted-foreground mb-3 flex items-start gap-1.5 text-xs leading-relaxed">
                <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                <span>{note}</span>
              </p>
            )}
            {children}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Shown in place of a body the sample cannot support.
 *
 * The content is still reachable behind a disclosure, deliberately. Hiding his
 * own nine payments from the person who runs the platform is a different kind
 * of dishonesty from letting him read a trend into them — the aim is only that
 * nobody arrives at a conclusion without first being told what it rests on.
 */
export function NotEnoughData({
  note,
  children,
}: {
  note: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed p-5 text-center">
      <p className="text-sm font-semibold">Not enough data to read this yet</p>
      <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-sm leading-relaxed">
        {note}
      </p>
      {children && (
        <details className="group mt-3 text-left">
          <summary className="text-muted-foreground hover:text-foreground marker:content-none mx-auto w-fit cursor-pointer rounded-lg border px-3 py-1.5 text-center text-xs font-semibold">
            Show it anyway
          </summary>
          <div className="mt-4">{children}</div>
        </details>
      )}
    </div>
  );
}

/**
 * The sample, on its own, for a panel that is not a `<Panel>` — a stat tile or
 * a chart embedded in somebody else's card.
 */
export function SampleChip({
  sample,
  className,
}: {
  sample: Sample;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-muted-foreground bg-muted/60 inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[11px] font-semibold wrap-anywhere",
        className,
      )}
    >
      {sampleLabel(sample)}
    </span>
  );
}
