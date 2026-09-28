/**
 * The age bands a church counts, and what it calls them.
 *
 * Churches do not agree on this. Some count Men and Women and nothing else.
 * Some split Teens out; some have a large Youth fellowship that would be
 * meaningless folded into Adults; a few count Senior members separately because
 * that is who the visitation team serves. The words differ too — "Youths",
 * "Young Adults", "Singles" are the same people to three different churches.
 *
 * So the BANDS are fixed and the LABELS are the church's own. Fixed bands mean
 * every count stays a real column: exports, analytics and the year-on-year
 * comparisons keep working, and a church that renames a band does not orphan
 * its own history. Free-form bands would make all of that a migration.
 *
 * Client-safe: no database, so the recording form, the settings page and the
 * reports all read the same definition.
 */

export type BandKey = "children" | "teens" | "youths" | "adults" | "seniors";

export type BandDefinition = {
  key: BandKey;
  /** What this church calls them. */
  label: string;
  enabled: boolean;
  /** The columns this band writes to, so callers never hardcode them. */
  maleColumn: string;
  femaleColumn: string;
};

type BandSeed = {
  key: BandKey;
  label: string;
  /** On for a church that has never configured anything. */
  defaultEnabled: boolean;
  maleColumn: string;
  femaleColumn: string;
  /** Shown in settings, so the church knows who a band is meant to hold. */
  hint: string;
};

/**
 * Oldest last, which is how a church reads its own attendance sheet.
 *
 * `adults` keeps the original `maleCount`/`femaleCount` columns. That is not
 * tidiness — those columns hold every adult ever recorded, and moving them
 * would rewrite years of history to mean something new.
 */
export const BAND_SEEDS: readonly BandSeed[] = [
  {
    key: "children",
    label: "Children",
    defaultEnabled: true,
    maleColumn: "childMaleCount",
    femaleColumn: "childFemaleCount",
    hint: "Up to around 12 — children's church.",
  },
  {
    key: "teens",
    label: "Teens",
    defaultEnabled: true,
    maleColumn: "teenMaleCount",
    femaleColumn: "teenFemaleCount",
    hint: "Roughly 13 to 19.",
  },
  {
    key: "youths",
    label: "Youths",
    defaultEnabled: false,
    maleColumn: "youthMaleCount",
    femaleColumn: "youthFemaleCount",
    hint: "Young adults, often the youth fellowship. Off until you turn it on — see the note below about what it does to your Adults figure.",
  },
  {
    key: "adults",
    label: "Adults",
    defaultEnabled: true,
    maleColumn: "maleCount",
    femaleColumn: "femaleCount",
    hint: "Everyone else. Historically recorded as Men and Women.",
  },
  {
    key: "seniors",
    label: "Senior members",
    defaultEnabled: false,
    maleColumn: "seniorMaleCount",
    femaleColumn: "seniorFemaleCount",
    hint: "Counted separately by churches whose visitation team serves them.",
  },
] as const;

export type BandConfig = Partial<Record<BandKey, { label?: string; enabled?: boolean }>>;

/**
 * What this church counts, with its own words.
 *
 * A church that has configured nothing gets the defaults, so attendance keeps
 * working untouched for everybody who never opens the settings page.
 *
 * Adults can never be switched off. Every attendance sheet ever recorded here
 * put its adults in that column, and a church that hid it would be looking at
 * years of history with the largest number missing.
 */
export function bandsFor(config: BandConfig | null | undefined): BandDefinition[] {
  return BAND_SEEDS.map((seed) => {
    const saved = config?.[seed.key];
    const label = saved?.label?.trim();
    return {
      key: seed.key,
      label: label && label.length > 0 ? label.slice(0, 40) : seed.label,
      enabled: seed.key === "adults" ? true : (saved?.enabled ?? seed.defaultEnabled),
      maleColumn: seed.maleColumn,
      femaleColumn: seed.femaleColumn,
    };
  });
}

/** Only the ones this church actually counts, in reading order. */
export function activeBands(config: BandConfig | null | undefined): BandDefinition[] {
  return bandsFor(config).filter((b) => b.enabled);
}

/**
 * Total attendance from a set of counts.
 *
 * Sums the bands the church has ENABLED, not every column. A church that turns
 * Youths off after recording some would otherwise keep those people in its
 * total for ever while having nowhere to see them — a figure that cannot be
 * reconciled with anything on the page.
 *
 * First-timers and new converts are deliberately not added: they are already
 * among the people counted above, and adding them counts somebody twice.
 */
export function totalFrom(
  counts: Record<string, number | null | undefined>,
  config: BandConfig | null | undefined,
): number {
  return activeBands(config).reduce(
    (sum, b) => sum + (counts[b.maleColumn] ?? 0) + (counts[b.femaleColumn] ?? 0),
    0,
  );
}

/** A label by key, for a report that only has the key to hand. */
export function labelFor(config: BandConfig | null | undefined, key: BandKey): string {
  return bandsFor(config).find((b) => b.key === key)?.label ?? key;
}

/**
 * Parse whatever is in the database into a config we trust.
 *
 * The column is jsonb and has been written by an older build, by a future one,
 * and conceivably by hand. Anything unrecognised is dropped rather than
 * carried, so one bad key cannot take the attendance form down.
 */
export function parseBandConfig(value: unknown): BandConfig {
  if (!value || typeof value !== "object") return {};
  const known = new Set<string>(BAND_SEEDS.map((b) => b.key));
  const out: BandConfig = {};

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!known.has(key) || !raw || typeof raw !== "object") continue;
    const v = raw as { label?: unknown; enabled?: unknown };
    out[key as BandKey] = {
      label: typeof v.label === "string" ? v.label.slice(0, 40) : undefined,
      enabled: typeof v.enabled === "boolean" ? v.enabled : undefined,
    };
  }
  return out;
}

/**
 * The bands this church counts, oldest first.
 *
 * The recording form asks for Senior members, then Adults, then Youths, Teens
 * and Children, because that is the order an usher's sheet runs in and it puts
 * the bands every church fills in — Adults above all — at the top of the
 * screen, where they are reached without scrolling.
 *
 * Derived by reversing BAND_SEEDS rather than listing the keys again: the
 * seeds are already ordered by age, so a band added there lands in the right
 * place here without anybody remembering to update a second list.
 */
export function recordingBands(config: BandConfig | null | undefined): BandDefinition[] {
  return activeBands(config).reverse();
}
