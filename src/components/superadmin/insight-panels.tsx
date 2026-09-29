import type { CohortInsight, DemographyInsight, EconomicsInsight } from "@/lib/insights";
import type { UsageOverview } from "@/lib/analytics";
import { shareLabel } from "@/lib/thin-data";
import { formatMoney } from "@/lib/money";
import { Panel } from "@/components/superadmin/panel";
import { ScrollableTable } from "@/components/ui/scrollable-table";

/**
 * The analytics suite. Each panel is a `<Panel>`, so each one states the sample
 * it rests on and refuses to imply a trend it cannot support.
 *
 * Several of these will render as "not enough data" for a while. That is the
 * intended output, not a gap to be filled with something more impressive: a
 * panel that admits it cannot answer is worth more than one that answers
 * wrongly with confidence.
 */

/** A horizontal bar, used wherever a share of a whole is the shape of the answer. */
function Bar({
  label,
  value,
  max,
  right,
}: {
  label: string;
  value: number;
  max: number;
  right: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
        <span className="truncate font-medium">{label}</span>
        <span className="text-muted-foreground shrink-0 tabular-nums">{right}</span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full"
          style={{ width: `${Math.round((value / Math.max(1, max)) * 100)}%` }}
        />
      </div>
    </div>
  );
}

export function CohortPanel({ data }: { data: CohortInsight }) {
  return (
    <Panel title="Do churches stay?" sample={data.sample} kind="churches">
      {data.rows.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-sm">
          No cohorts yet — this fills as churches pass their fourth week.
        </p>
      ) : (
        <ScrollableTable label="Retention by signup month">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="py-2 font-medium">Signed up</th>
                <th className="py-2 text-right font-medium">Churches</th>
                <th className="py-2 text-right font-medium">Week 4</th>
                <th className="py-2 text-right font-medium">Week 8</th>
                <th className="py-2 text-right font-medium">Week 12</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.month} className="border-b last:border-0">
                  <td className="py-2 font-medium whitespace-nowrap">{r.month}</td>
                  <td className="py-2 text-right tabular-nums">{r.signups}</td>
                  <Cell part={r.week4} whole={r.signups} />
                  <Cell part={r.week8} whole={r.signups} />
                  <Cell part={r.week12} whole={r.signups} />
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      )}
    </Panel>
  );
}

/**
 * A retention cell.
 *
 * `null` already means "this cohort is too young to judge" — the accessor is
 * careful about that and the table must not turn it into a zero, which would
 * read as total churn.
 */
function Cell({ part, whole }: { part: number | null; whole: number }) {
  return (
    <td className="py-2 text-right tabular-nums">
      {part === null ? (
        <span className="text-muted-foreground/60">—</span>
      ) : (
        shareLabel(part, whole)
      )}
    </td>
  );
}

export function AdoptionPanel({ overview }: { overview: UsageOverview }) {
  const sample = {
    n: overview.totalPageviews30,
    churches: overview.activeChurches30,
    unit: "pageviews",
  };
  const max = Math.max(1, ...overview.topFeatures.map((f) => f.views));
  const cold = overview.topFeatures.filter((f) => f.churches <= 1);

  return (
    <Panel title="What the product is actually for" sample={sample} kind="events">
      <div className="space-y-3">
        {overview.topFeatures.slice(0, 12).map((f) => (
          <Bar
            key={f.name}
            label={f.name}
            value={f.views}
            max={max}
            right={`${shareLabel(f.churches, overview.activeChurches30)} of churches`}
          />
        ))}
      </div>

      {cold.length > 0 && (
        <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
          Reached by one church or none:{" "}
          <span className="font-semibold">{cold.map((f) => f.name).join(", ")}</span>. A
          module nobody opens is either undiscovered or unwanted, and those need
          opposite responses.
        </p>
      )}
    </Panel>
  );
}

export function EconomicsPanel({ data }: { data: EconomicsInsight }) {
  return (
    <Panel title="What each plan earns" sample={data.sample} kind="money">
      <ScrollableTable label="Economics by plan">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left">
              <th className="py-2 font-medium">Plan</th>
              <th className="py-2 text-right font-medium">Churches</th>
              <th className="py-2 text-right font-medium">Revenue</th>
              <th className="py-2 text-right font-medium">Cost to serve</th>
              <th className="py-2 text-right font-medium">Margin</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.plan} className="border-b last:border-0">
                <td className="py-2 font-medium capitalize">{r.plan}</td>
                <td className="py-2 text-right tabular-nums">{r.churches}</td>
                <td className="py-2 text-right tabular-nums">{formatMoney(r.revenue)}</td>
                <td className="py-2 text-right tabular-nums">
                  {formatMoney(r.smsCost + r.storageCost)}
                </td>
                <td className="py-2 text-right font-semibold tabular-nums">
                  {formatMoney(r.margin)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
    </Panel>
  );
}

export function DemographyPanel({ data }: { data: DemographyInsight }) {
  const total = data.sample.n;
  return (
    <Panel title="Who the members are" sample={data.sample} kind="people">
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-muted-foreground mb-2 text-[11px] font-bold tracking-wide uppercase">
            Age
          </h3>
          <div className="space-y-3">
            {data.ageBands.map((b) => (
              <Bar
                key={b.label}
                label={b.label}
                value={b.value}
                max={total}
                right={shareLabel(b.value, total)}
              />
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-muted-foreground mb-2 text-[11px] font-bold tracking-wide uppercase">
            Where they are
          </h3>
          <div className="space-y-3">
            {data.states.map((b) => (
              <Bar
                key={b.label}
                label={b.label}
                value={b.value}
                max={total}
                right={shareLabel(b.value, total)}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
        Aggregate only, and deliberately not cut any finer. At this size a
        narrower slice would identify individual people in somebody else&rsquo;s
        congregation.
      </p>
    </Panel>
  );
}
