import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { cn } from "@/lib/utils";
import {
  FREE_GB_PER_MONTH,
  USD_PER_GB,
  type ChurchUsage,
  type UsageWindow,
} from "@/lib/meeting-usage";

/**
 * What meetings cost this month, and where it is heading.
 *
 * Measured from what participants' browsers actually received, not modelled
 * from a bitrate ladder — so a month where nobody turned a camera on reads as
 * nearly free, which is the truth.
 */

function gb(n: number): string {
  if (n < 0.01) return "0 GB";
  if (n < 1) return `${(n * 1024).toFixed(0)} MB`;
  return `${n.toFixed(n < 10 ? 2 : 1)} GB`;
}

function usd(n: number): string {
  if (n === 0) return "$0";
  return `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;
}

export function MeetingCost({
  month,
  projection,
  churches,
}: {
  month: UsageWindow;
  projection: { gb: number; costUsd: number };
  churches: ChurchUsage[];
}) {
  const usedPct = Math.min(100, (month.gb / FREE_GB_PER_MONTH) * 100);
  const projectedPct = Math.min(100, (projection.gb / FREE_GB_PER_MONTH) * 100);
  const willExceed = projection.gb > FREE_GB_PER_MONTH;

  /*
   * Per meeting-hour, which is the number that answers "what should we charge".
   * Total cost over total hours rather than an average of per-meeting rates:
   * one enormous meeting should weigh more than one two-minute test.
   */
  const hours = month.minutes / 60;
  const perHourGb = hours > 0 ? month.gb / hours : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Meeting media &amp; cost</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          Measured from what people actually received, this calendar month.
          Only meetings using the media server cost anything — peer-to-peer
          rooms go straight between browsers.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Used" value={gb(month.gb)} />
          <Stat
            label="Cost so far"
            value={usd(month.costUsd)}
            hint={month.costUsd === 0 ? "inside the free tier" : undefined}
          />
          <Stat
            label="Projected"
            value={gb(projection.gb)}
            hint={`${usd(projection.costUsd)} by month end`}
            warn={willExceed}
          />
          <Stat
            label="Per meeting-hour"
            value={perHourGb > 0 ? gb(perHourGb) : "—"}
            hint={perHourGb > 0 ? `${usd(perHourGb * USD_PER_GB)} an hour` : undefined}
          />
        </div>

        {/*
          The free tier as a bar, because "412 GB of 1,000" is a fact and
          "you are 41% of the way to paying for this" is a decision.
        */}
        <div>
          <div className="text-muted-foreground mb-1.5 flex items-center justify-between text-xs">
            <span>Free allowance</span>
            <span className="tabular-nums">
              {gb(month.gb)} of {FREE_GB_PER_MONTH} GB
            </span>
          </div>
          <div className="bg-muted relative h-2.5 overflow-hidden rounded-full">
            {/* Where the month is heading, behind where it actually is. */}
            <div
              className={cn(
                "absolute inset-y-0 left-0 rounded-full",
                willExceed ? "bg-amber-500/30" : "bg-primary/20",
              )}
              style={{ width: `${projectedPct}%` }}
            />
            <div
              className={cn(
                "absolute inset-y-0 left-0 rounded-full",
                usedPct >= 100 ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${usedPct}%` }}
            />
          </div>
          <p className="text-muted-foreground mt-1.5 text-[11px]">
            {willExceed
              ? `On this trend you pass the free tier this month and pay about ${usd(projection.costUsd)}. Egress is $${USD_PER_GB.toFixed(2)} a GB after the first ${FREE_GB_PER_MONTH} GB, shared with TURN.`
              : `On this trend the month stays inside the free ${FREE_GB_PER_MONTH} GB, shared with TURN.`}
          </p>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">
            By church ({month.meetings} meetings, {month.participants} joins)
          </p>
          {churches.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No meetings have used the media server yet this month.
            </p>
          ) : (
            <ScrollableTable stickyFirstColumn label="Media cost by church">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b text-left text-xs">
                  <tr>
                    <th className="py-2 font-medium">Church</th>
                    <th className="py-2 font-medium">Plan</th>
                    <th className="py-2 text-right font-medium">Meetings</th>
                    <th className="py-2 text-right font-medium">Joins</th>
                    <th className="py-2 text-right font-medium">Media</th>
                    <th className="py-2 text-right font-medium">At list rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {churches.map((c) => (
                    <tr key={c.churchId}>
                      <td className="py-2 font-medium">{c.churchName}</td>
                      <td className="text-muted-foreground py-2 capitalize">{c.plan}</td>
                      <td className="py-2 text-right tabular-nums">{c.meetings}</td>
                      <td className="py-2 text-right tabular-nums">{c.participants}</td>
                      <td className="py-2 text-right tabular-nums">{gb(c.gb)}</td>
                      <td className="py-2 text-right tabular-nums">{usd(c.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
          )}
          <p className="text-muted-foreground mt-2 text-[11px]">
            &ldquo;At list rate&rdquo; is what a church&apos;s own traffic would cost at
            ${USD_PER_GB.toFixed(2)} a GB, ignoring the shared free tier — so the
            column says who is expensive, rather than dividing an allowance that
            moves every time somebody else holds a meeting.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-muted-foreground text-[11px] font-medium">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-extrabold tabular-nums",
          warn && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-muted-foreground mt-0.5 text-[11px]">{hint}</p>}
    </div>
  );
}
