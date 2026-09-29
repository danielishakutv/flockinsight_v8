/**
 * How much a number can be trusted, and how to say so.
 *
 * FlockInsight has fourteen churches. Almost every platform metric is drawn
 * from single or low double digits, and a chart drawn from four observations
 * looks exactly like a chart drawn from four thousand — same confident line,
 * same air of authority. The danger is not an empty panel, it is a full one
 * that cannot bear the weight a reader puts on it.
 *
 * So every panel declares its sample, and the sample decides how the panel is
 * allowed to speak. Pure, with no database and no server-only import, so the
 * rules are unit-testable and the chips can render on the client.
 */

export type Sample = {
  /** Rows behind the number. */
  n: number;
  /**
   * Independent churches contributing to it.
   *
   * This is the number that matters and the reason `Sample` is not a single
   * integer. Four hundred and twenty-five members sound like a sturdy sample
   * until you notice they live inside five churches: one church changing how
   * it records moves the "population" by a fifth. For anything cross-church,
   * the honest n is the church count, and labelling it 425 borrows three-digit
   * authority for five observations.
   */
  churches: number;
  /** What the rows are — "members", "payments", "events"… */
  unit: string;
};

export type MetricKind =
  | "churches" // cohorts, retention, funnel, health mix
  | "money" // pricing, ARPU, margin, P&L
  | "people" // demography
  | "events" // usage, feature adoption
  | "series"; // any time series

export type Readability = "solid" | "thin" | "too_thin";

/**
 * Thresholds per kind, because the kinds do not fail at the same size.
 *
 * Twenty payments is a thin but readable revenue picture; twenty members is
 * nothing at all. A single global cut-off would either silence honest panels
 * or wave through noisy ones, and the temptation is always to set it where the
 * current data happens to pass.
 */
const RULES: Record<
  MetricKind,
  { tooThin: (s: Sample) => boolean; thin: (s: Sample) => boolean }
> = {
  churches: {
    tooThin: (s) => s.n < 10,
    thin: (s) => s.n < 30,
  },
  money: {
    tooThin: (s) => s.n < 20 || s.churches < 10,
    thin: (s) => s.n < 60,
  },
  people: {
    tooThin: (s) => s.churches < 5 || s.n < 100,
    thin: (s) => s.churches < 15,
  },
  events: {
    tooThin: (s) => s.churches < 5 || s.n < 500,
    thin: (s) => s.churches < 15,
  },
  series: {
    // `n` for a series is points that actually carry a value — see seriesSample.
    tooThin: (s) => s.n < 5,
    thin: (s) => s.n < 20,
  },
};

export function readability(s: Sample, kind: MetricKind): Readability {
  const r = RULES[kind];
  if (r.tooThin(s)) return "too_thin";
  if (r.thin(s)) return "thin";
  return "solid";
}

/**
 * A time series is as strong as its non-empty points, not its length.
 *
 * A ninety-day chart where eighty-two days are flat zero is eight
 * observations wearing ninety days of x-axis, and it renders as a confident
 * line with a dramatic slope at the end. Counting only the points that carry a
 * value is what stops that reading.
 */
export function seriesSample(
  values: readonly number[],
  churches: number,
  unit = "days with activity",
): Sample {
  return { n: values.filter((v) => v > 0).length, churches, unit };
}

/** "425 members · from 5 churches" */
export function sampleLabel(s: Sample): string {
  const rows = `${s.n.toLocaleString()} ${s.unit}`;
  if (s.churches <= 0) return rows;
  return `${rows} · from ${s.churches} ${s.churches === 1 ? "church" : "churches"}`;
}

const NOTES: Record<MetricKind, { thin: string; too_thin: string }> = {
  churches: {
    thin: "A small number of churches — read the direction, not the number.",
    too_thin: "Too few churches to read a pattern into yet.",
  },
  money: {
    thin: "Few enough payments that one church moves the whole figure.",
    too_thin: "Too few payments to say anything about pricing yet.",
  },
  people: {
    thin: "These people come from a handful of churches — one church's habits shape the shape.",
    too_thin: "Too few churches contributing for this to describe anyone but them.",
  },
  events: {
    thin: "A handful of churches generate all of this — it shows their habits, not the market's.",
    too_thin: "Too little usage from too few churches to read yet.",
  },
  series: {
    thin: "Few points carry a value, so the line is sparser than it looks.",
    too_thin: "Not enough days with activity to draw a trend.",
  },
};

/** The sentence shown above a thin panel, or in place of a too-thin one. */
export function readabilityNote(r: Readability, kind: MetricKind): string {
  return r === "solid" ? "" : NOTES[kind][r];
}

/**
 * A share, but never a percentage over a denominator too small to carry one.
 *
 * "67% retention" from two churches out of three is the exact failure this
 * whole module exists to prevent: the percentage invents a precision the data
 * has not earned, and it reads identically to 67% of three thousand. Below ten
 * the count is the honest form, and it is also the more useful one — "3 of 9"
 * tells you who to go and ring.
 */
export const MIN_DENOMINATOR_FOR_PERCENT = 10;

export function shareLabel(part: number, whole: number): string {
  if (whole <= 0) return "—";
  if (whole < MIN_DENOMINATOR_FOR_PERCENT) return `${part} of ${whole}`;
  return `${Math.round((part / whole) * 100)}%`;
}
