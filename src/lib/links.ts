import "server-only";
import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  qrCode,
  shortLink,
  shortLinkDestination,
  shortLinkStat,
  user,
} from "@/db/schema";
import {
  LINK_STATUSES,
  normaliseCode,
  randomCode,
  type LinkStatus,
} from "@/lib/links-shared";

/**
 * Short links, against the database.
 *
 * The rules about what a code and a destination may be live in
 * `links-shared.ts`, which is pure and tested. This is the half that needs
 * rows: finding a free code, recording the history of a destination, counting
 * a click without letting the counting grow without bound.
 */

/* ============================================================
 * Reading
 * ========================================================== */

export type LinkRow = {
  id: string;
  code: string;
  title: string | null;
  destination: string;
  status: LinkStatus;
  note: string | null;
  expiresAt: Date | null;
  clickCount: number;
  lastClickAt: Date | null;
  createdAt: Date;
  createdByName: string | null;
  /** How many QR codes point at this link — what makes it dangerous to retire. */
  qrCount: number;
  /**
   * Whether the expiry has already passed.
   *
   * Decided here rather than in the page or the component. Reading the clock
   * during a render is not idempotent — React may re-render at any moment and
   * get a different answer — and the lint rule that enforces that is right:
   * this is derived DATA, and it belongs beside the query that produced the
   * row it describes.
   */
  expired: boolean;
};

/**
 * Every link a church has, newest first.
 *
 * The QR count is a grouped aggregate joined in JS rather than a correlated
 * subquery, deliberately. A `sql` template holding
 * `(select count(*) from qr_code where qr_code.short_link_id = short_link.id)`
 * renders without the table qualifier in a query that has no join, so Postgres
 * binds both sides to the inner table and the count comes back 0 — silently,
 * for ever. See the note in AGENTS.md; `lib/sql-safety.test.ts` fails the build
 * on the shape.
 */
export async function listLinks(
  churchId: string,
  options: { status?: LinkStatus | "all"; query?: string } = {},
): Promise<LinkRow[]> {
  const where = [eq(shortLink.churchId, churchId)];
  if (options.status && options.status !== "all") {
    where.push(eq(shortLink.status, options.status));
  }
  const q = options.query?.trim();
  if (q) {
    where.push(
      or(
        ilike(shortLink.code, `%${q}%`),
        ilike(shortLink.title, `%${q}%`),
        ilike(shortLink.destination, `%${q}%`),
      )!,
    );
  }

  const rows = await db
    .select({
      id: shortLink.id,
      code: shortLink.code,
      title: shortLink.title,
      destination: shortLink.destination,
      status: shortLink.status,
      note: shortLink.note,
      expiresAt: shortLink.expiresAt,
      clickCount: shortLink.clickCount,
      lastClickAt: shortLink.lastClickAt,
      createdAt: shortLink.createdAt,
      createdByName: user.name,
    })
    .from(shortLink)
    .leftJoin(user, eq(user.id, shortLink.createdBy))
    .where(and(...where))
    .orderBy(desc(shortLink.createdAt));

  if (rows.length === 0) return [];

  const counts = await db
    .select({ linkId: qrCode.shortLinkId, count: sql<number>`count(*)::int` })
    .from(qrCode)
    .where(
      and(
        eq(qrCode.churchId, churchId),
        inArray(
          qrCode.shortLinkId,
          rows.map((r) => r.id),
        ),
      ),
    )
    .groupBy(qrCode.shortLinkId);

  const byLink = new Map(counts.map((c) => [c.linkId, Number(c.count)]));
  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    qrCount: byLink.get(r.id) ?? 0,
    expired: r.expiresAt !== null && r.expiresAt.getTime() <= now,
  }));
}

export async function getLink(churchId: string, id: string): Promise<LinkRow | null> {
  const [row] = await listLinksById(churchId, [id]);
  return row ?? null;
}

async function listLinksById(churchId: string, ids: string[]): Promise<LinkRow[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: shortLink.id,
      code: shortLink.code,
      title: shortLink.title,
      destination: shortLink.destination,
      status: shortLink.status,
      note: shortLink.note,
      expiresAt: shortLink.expiresAt,
      clickCount: shortLink.clickCount,
      lastClickAt: shortLink.lastClickAt,
      createdAt: shortLink.createdAt,
      createdByName: user.name,
    })
    .from(shortLink)
    .leftJoin(user, eq(user.id, shortLink.createdBy))
    .where(and(eq(shortLink.churchId, churchId), inArray(shortLink.id, ids)));

  const counts = await db
    .select({ linkId: qrCode.shortLinkId, count: sql<number>`count(*)::int` })
    .from(qrCode)
    .where(and(eq(qrCode.churchId, churchId), inArray(qrCode.shortLinkId, ids)))
    .groupBy(qrCode.shortLinkId);
  const byLink = new Map(counts.map((c) => [c.linkId, Number(c.count)]));
  const now = Date.now();

  return rows.map((r) => ({
    ...r,
    qrCount: byLink.get(r.id) ?? 0,
    expired: r.expiresAt !== null && r.expiresAt.getTime() <= now,
  }));
}

/**
 * Resolve a code for the redirect. No church, because the visitor has none.
 *
 * Deliberately the narrowest select in the file: this runs on every scan of
 * every printed poster, and the only columns a redirect needs are where to go
 * and whether to go there.
 */
export async function resolveCode(code: string): Promise<{
  id: string;
  churchId: string;
  destination: string;
  status: string;
  expiresAt: Date | null;
} | null> {
  const normalised = normaliseCode(code);
  if (!normalised) return null;
  const [row] = await db
    .select({
      id: shortLink.id,
      churchId: shortLink.churchId,
      destination: shortLink.destination,
      status: shortLink.status,
      expiresAt: shortLink.expiresAt,
    })
    .from(shortLink)
    .where(eq(shortLink.code, normalised))
    .limit(1);
  return row ?? null;
}

/** Is this code already taken, by anybody? */
export async function codeTaken(code: string, exceptId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: shortLink.id })
    .from(shortLink)
    .where(eq(shortLink.code, code))
    .limit(1);
  if (!row) return false;
  return row.id !== exceptId;
}

/**
 * A free code, derived from a title where there is one.
 *
 * Tries the readable form first, because `flockinsight.com/l/carol-service` is
 * worth more on a poster than `flockinsight.com/l/k3m9xq`. Falls back to
 * random, and lengthens the random part rather than looping for ever — six
 * characters from a 31-letter alphabet is 28 million, so a third collision
 * means something is wrong rather than unlucky.
 */
export async function freeCode(preferred?: string | null): Promise<string> {
  const base = normaliseCode(preferred ?? "");
  if (base.length >= 3 && !(await codeTaken(base))) return base;

  for (const length of [6, 6, 7, 8, 10]) {
    const candidate = randomCode(length);
    if (!(await codeTaken(candidate))) return candidate;
  }
  // Five collisions in a row is not luck. A longer code always works and is
  // better than throwing in the middle of somebody creating a link.
  return randomCode(14);
}

/* ============================================================
 * Writing
 * ========================================================== */

export async function createLink(input: {
  churchId: string;
  code: string;
  destination: string;
  title: string | null;
  note: string | null;
  expiresAt: Date | null;
  userId: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const [row] = await db
      .insert(shortLink)
      .values({
        churchId: input.churchId,
        code: input.code,
        destination: input.destination,
        title: input.title,
        note: input.note,
        expiresAt: input.expiresAt,
        createdBy: input.userId,
      })
      .returning({ id: shortLink.id });

    /*
     * The first destination is recorded as history too. A history that starts
     * at the first CHANGE cannot show what the link originally did, which is
     * exactly the question somebody asks when a poster stops working.
     */
    await db.insert(shortLinkDestination).values({
      linkId: row.id,
      churchId: input.churchId,
      destination: input.destination,
      changedBy: input.userId,
    });

    return { ok: true, id: row.id };
  } catch (error) {
    /*
     * Classified, not swallowed. The unique index on `code` is the one failure
     * that happens in normal use — two people creating "give" in the same
     * minute — and it deserves its own sentence rather than "something went
     * wrong". Anything else is a real fault and is logged.
     */
    if (isUniqueViolation(error, "short_link_code_unique")) {
      return {
        ok: false,
        error: "That code has just been taken. Try another one.",
      };
    }
    console.error("[links] createLink failed", error);
    return {
      ok: false,
      error: "The link could not be saved. Please try again.",
    };
  }
}

export async function updateLink(input: {
  churchId: string;
  id: string;
  code: string;
  destination: string;
  title: string | null;
  note: string | null;
  expiresAt: Date | null;
  status: LinkStatus;
  userId: string;
}): Promise<
  { ok: true; destinationChanged: boolean } | { ok: false; error: string }
> {
  const [existing] = await db
    .select({ destination: shortLink.destination })
    .from(shortLink)
    .where(and(eq(shortLink.id, input.id), eq(shortLink.churchId, input.churchId)))
    .limit(1);
  if (!existing) return { ok: false, error: "That link no longer exists." };

  const destinationChanged = existing.destination !== input.destination;

  try {
    await db
      .update(shortLink)
      .set({
        code: input.code,
        destination: input.destination,
        title: input.title,
        note: input.note,
        expiresAt: input.expiresAt,
        status: input.status,
      })
      .where(and(eq(shortLink.id, input.id), eq(shortLink.churchId, input.churchId)));
  } catch (error) {
    if (isUniqueViolation(error, "short_link_code_unique")) {
      return { ok: false, error: "That code belongs to another link." };
    }
    console.error("[links] updateLink failed", error);
    return { ok: false, error: "The link could not be saved. Please try again." };
  }

  if (destinationChanged) {
    await db.insert(shortLinkDestination).values({
      linkId: input.id,
      churchId: input.churchId,
      destination: input.destination,
      changedBy: input.userId,
    });
  }

  return { ok: true, destinationChanged };
}

export async function setLinkStatus(
  churchId: string,
  id: string,
  status: LinkStatus,
): Promise<boolean> {
  const rows = await db
    .update(shortLink)
    .set({ status })
    .where(and(eq(shortLink.id, id), eq(shortLink.churchId, churchId)))
    .returning({ id: shortLink.id });
  return rows.length > 0;
}

/** The addresses this link has pointed at, newest first. */
export async function destinationHistory(
  churchId: string,
  linkId: string,
): Promise<{ destination: string; changedAt: Date; changedByName: string | null }[]> {
  return db
    .select({
      destination: shortLinkDestination.destination,
      changedAt: shortLinkDestination.createdAt,
      changedByName: user.name,
    })
    .from(shortLinkDestination)
    .leftJoin(user, eq(user.id, shortLinkDestination.changedBy))
    .where(
      and(
        eq(shortLinkDestination.linkId, linkId),
        eq(shortLinkDestination.churchId, churchId),
      ),
    )
    .orderBy(desc(shortLinkDestination.createdAt));
}

/* ============================================================
 * Counting a click
 * ========================================================== */

/**
 * Count one click.
 *
 * Two statements, both upserts, and nothing that grows per click:
 *
 *   1. The three buckets in `short_link_stat` — the day, where it came from,
 *      and what kind of device. One INSERT with three rows and
 *      ON CONFLICT DO UPDATE, so it is one round trip.
 *   2. The denormalised total on the link itself, so a list of forty links
 *      does not need forty aggregates.
 *
 * NEVER THROWS, and never blocks the redirect. A visitor scanning a poster
 * outside a church on a bad connection gets sent where they were going whether
 * or not we managed to write that down. The caller hands this to `after()`, so
 * the redirect is already on its way.
 *
 * `day` is passed in rather than read from the clock here so the caller can be
 * tested, and so a church's own timezone decides which day a Sunday-evening
 * scan belongs to.
 */
export async function recordClick(input: {
  linkId: string;
  churchId: string;
  day: string;
  source: string;
  device: string;
}): Promise<void> {
  try {
    await db
      .insert(shortLinkStat)
      .values([
        { linkId: input.linkId, churchId: input.churchId, bucket: "day", key: input.day, clicks: 1 },
        { linkId: input.linkId, churchId: input.churchId, bucket: "source", key: input.source, clicks: 1 },
        { linkId: input.linkId, churchId: input.churchId, bucket: "device", key: input.device, clicks: 1 },
      ])
      .onConflictDoUpdate({
        target: [shortLinkStat.linkId, shortLinkStat.bucket, shortLinkStat.key],
        /*
         * `+ 1` against the stored column, not against the proposed row. In
         * Postgres a bare column reference inside DO UPDATE SET is the EXISTING
         * row, which is what makes this an increment; `excluded.clicks` would
         * be the 1 above and would pin every total at 1 for ever.
         */
        set: {
          clicks: sql`${shortLinkStat.clicks} + 1`,
          updatedAt: new Date(),
        },
      });

    await db
      .update(shortLink)
      .set({
        clickCount: sql`${shortLink.clickCount} + 1`,
        lastClickAt: new Date(),
      })
      .where(eq(shortLink.id, input.linkId));
  } catch (error) {
    // Recorded, not hidden. A click that was not counted is a small loss; a
    // redirect that failed because counting failed would be a real one.
    console.error("[links] recordClick failed", { linkId: input.linkId }, error);
  }
}

/* ============================================================
 * Reading the counts back
 * ========================================================== */

export type LinkStats = {
  total: number;
  /** One entry per day in the window, including the days with no clicks. */
  byDay: { day: string; clicks: number }[];
  sources: { key: string; clicks: number }[];
  devices: { key: string; clicks: number }[];
};

/**
 * The figures for one link.
 *
 * `byDay` is filled in for every day in the window, including the empty ones.
 * A chart drawn only from the days that have rows draws a line between a
 * Tuesday and the following Monday as though the week between had been busy —
 * which is the one thing a church would read off it.
 */
export async function linkStats(
  churchId: string,
  linkId: string,
  days = 30,
  today = new Date(),
): Promise<LinkStats> {
  const window = dayKeys(days, today);
  const earliest = window[0];

  const rows = await db
    .select({
      bucket: shortLinkStat.bucket,
      key: shortLinkStat.key,
      clicks: shortLinkStat.clicks,
    })
    .from(shortLinkStat)
    .where(
      and(
        eq(shortLinkStat.linkId, linkId),
        eq(shortLinkStat.churchId, churchId),
        // The day rows are limited to the window; sources and devices are
        // all-time, because "where do people find this" is not a question
        // about the last thirty days.
        or(
          and(eq(shortLinkStat.bucket, "day"), gte(shortLinkStat.key, earliest)),
          inArray(shortLinkStat.bucket, ["source", "device"]),
        )!,
      ),
    );

  const dayTotals = new Map<string, number>();
  const sources: { key: string; clicks: number }[] = [];
  const devices: { key: string; clicks: number }[] = [];

  for (const row of rows) {
    if (row.bucket === "day") dayTotals.set(row.key, row.clicks);
    else if (row.bucket === "source") sources.push({ key: row.key, clicks: row.clicks });
    else if (row.bucket === "device") devices.push({ key: row.key, clicks: row.clicks });
  }

  const [totalRow] = await db
    .select({ total: shortLink.clickCount })
    .from(shortLink)
    .where(and(eq(shortLink.id, linkId), eq(shortLink.churchId, churchId)))
    .limit(1);

  return {
    total: totalRow?.total ?? 0,
    byDay: window.map((day) => ({ day, clicks: dayTotals.get(day) ?? 0 })),
    sources: sources.sort((a, b) => b.clicks - a.clicks).slice(0, 12),
    devices: devices.sort((a, b) => b.clicks - a.clicks),
  };
}

/** Clicks per day across every link, for the module's overview. */
export async function churchLinkStats(
  churchId: string,
  days = 30,
  today = new Date(),
): Promise<{ byDay: { day: string; clicks: number }[]; total: number; scans: number }> {
  const window = dayKeys(days, today);
  const rows = await db
    .select({
      bucket: shortLinkStat.bucket,
      key: shortLinkStat.key,
      clicks: sql<number>`sum(${shortLinkStat.clicks})::int`,
    })
    .from(shortLinkStat)
    .where(and(eq(shortLinkStat.churchId, churchId), inArray(shortLinkStat.bucket, ["day", "source"])))
    .groupBy(shortLinkStat.bucket, shortLinkStat.key);

  const dayTotals = new Map<string, number>();
  let scans = 0;
  let total = 0;
  for (const row of rows) {
    const clicks = Number(row.clicks);
    if (row.bucket === "day") {
      dayTotals.set(row.key, clicks);
      total += clicks;
    } else if (row.key === "qr") {
      scans = clicks;
    }
  }

  return {
    byDay: window.map((day) => ({ day, clicks: dayTotals.get(day) ?? 0 })),
    total,
    scans,
  };
}

/**
 * The last `days` dates as YYYY-MM-DD, oldest first.
 *
 * Built by subtracting days from a UTC midnight rather than by mutating a
 * local Date, because the second form skips or repeats a day wherever the
 * clocks change — and this platform now serves churches in several countries.
 */
export function dayKeys(days: number, today = new Date()): string[] {
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** Today's date key, in a church's own timezone. */
export function dayKeyIn(timezone: string | null | undefined, now = new Date()): string {
  if (!timezone) return now.toISOString().slice(0, 10);
  try {
    // `en-CA` formats as YYYY-MM-DD, which is the key format, rather than
    // needing the parts to be reassembled by hand.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    // An unknown timezone string, which is a settings problem rather than a
    // reason to lose the click. UTC is the honest fallback.
    return now.toISOString().slice(0, 10);
  }
}

/* ============================================================
 * Errors
 * ========================================================== */

/**
 * Is this the unique-index violation we were expecting, and not another?
 *
 * WALKS THE `cause` CHAIN, and that is the whole point of the function.
 * Drizzle wraps a driver error in a `DrizzleQueryError` and puts the real one
 * underneath — so the obvious version, reading `error.code` off what it was
 * handed, matches nothing. Two people creating the short link "give" in the
 * same minute then got "The link could not be saved. Please try again." rather
 * than "That code has just been taken. Try another one.", which sends somebody
 * to try again at exactly the thing that cannot work.
 *
 * Found by `links.db-check.ts` against a real Postgres. It is not findable any
 * other way: the shape of a wrapped driver error is not something a unit test
 * with a stubbed database would have got right either.
 */
function isUniqueViolation(error: unknown, constraint?: string): boolean {
  /** Postgres `unique_violation`. */
  const UNIQUE_VIOLATION = "23505";

  // A bounded walk: a cycle in a cause chain would otherwise hang the request.
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth++) {
    const e = current as {
      code?: unknown;
      constraint?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (e.code === UNIQUE_VIOLATION) {
      if (!constraint) return true;
      return e.constraint === constraint || e.constraint_name === constraint;
    }
    current = e.cause;
  }
  return false;
}

export { LINK_STATUSES };
