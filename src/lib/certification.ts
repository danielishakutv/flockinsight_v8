import "server-only";
/**
 * The FlockInsight course: reads and writes.
 *
 * Every row here belongs to a PERSON, not a church (see the schema note above
 * guide_progress), so tenancy is the signed-in user's own id: every statement
 * that writes is keyed on it, and the only reads of somebody else's rows are
 * the rank chips, which return the rank and nothing more. No correlated
 * subqueries; IN lists are chunked so a large team cannot build a statement
 * past Postgres's parameter limit.
 */
import { and, asc, count, eq, gte, inArray, isNull, min, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  guideProgress,
  guideQuizAttempt,
  platformCertificate,
  user,
  userActiveDay,
} from "@/db/schema";
import {
  activeStanding,
  cryptoRandom,
  EMPTY_STANDING,
  generateCertCode,
  highestRank,
  rankInfo,
  ranksEarned,
  shuffleWith,
  type CertRank,
  type Standing,
} from "@/lib/certification-shared";
import { CURRICULUM } from "@/lib/guide-quizzes";
import { isUniqueViolation } from "@/lib/pg-errors";
import { audit, auditSystem } from "@/lib/audit";
import { notifyUser } from "@/lib/notifications";

export type ProgressRow = typeof guideProgress.$inferSelect;
export type CertificateRow = typeof platformCertificate.$inferSelect;

const CHUNK = 500;

function chunks<T>(xs: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** The option order for one request, from the CSPRNG. Decided on the server only. */
export const cryptoShuffle = shuffleWith(cryptoRandom);

/* ------------------------------------------------------------------ *
 * Progress
 * ------------------------------------------------------------------ */

export async function getGuideProgress(userId: string, slug: string): Promise<ProgressRow | null> {
  const [row] = await db
    .select()
    .from(guideProgress)
    .where(and(eq(guideProgress.userId, userId), eq(guideProgress.guideSlug, slug)))
    .limit(1);
  return row ?? null;
}

export async function listProgress(userId: string): Promise<ProgressRow[]> {
  return db.select().from(guideProgress).where(eq(guideProgress.userId, userId));
}

export async function listCertificates(userId: string): Promise<CertificateRow[]> {
  return db
    .select()
    .from(platformCertificate)
    .where(eq(platformCertificate.userId, userId))
    .orderBy(asc(platformCertificate.issuedAt));
}

/** "I have read it". The first completedAt is kept: a second press changes nothing. */
export async function markComplete(userId: string, slug: string): Promise<void> {
  await db
    .insert(guideProgress)
    .values({ userId, guideSlug: slug })
    .onConflictDoNothing({ target: [guideProgress.userId, guideProgress.guideSlug] });
}

/**
 * Attempts in the retake window, read from the attempts table rather than an
 * in-memory limiter: that would be per PM2 worker and wiped by every deploy.
 * A race can let one extra attempt through, which harms nothing; this is a
 * pace, not a claim.
 */
export async function recentAttemptCount(
  userId: string,
  slug: string,
  since: Date,
): Promise<{ count: number; oldest: Date | null }> {
  const [row] = await db
    .select({ n: count(), oldest: min(guideQuizAttempt.createdAt) })
    .from(guideQuizAttempt)
    .where(
      and(
        eq(guideQuizAttempt.userId, userId),
        eq(guideQuizAttempt.guideSlug, slug),
        gte(guideQuizAttempt.createdAt, since),
      ),
    );
  const oldest = row?.oldest ? new Date(row.oldest as Date | string) : null;
  return { count: Number(row?.n ?? 0), oldest };
}

/**
 * Store an attempt and fold it into the module's progress, together.
 *
 * The progress change is ONE atomic UPDATE computed from the row's own
 * values (attempts + 1, the greater score, passedAt kept once set), so
 * nothing is read and then written and no lock is needed. The transaction
 * only makes the attempt and the progress land or fail as one.
 */
export async function recordAttempt(input: {
  userId: string;
  slug: string;
  version: string;
  answers: number[];
  correct: number;
  total: number;
  passed: boolean;
  churchId: string | null;
}): Promise<void> {
  const pct = Math.round((input.correct / input.total) * 100);
  await db.transaction(async (tx) => {
    await tx.insert(guideQuizAttempt).values({
      userId: input.userId,
      guideSlug: input.slug,
      quizVersion: input.version,
      correct: input.correct,
      total: input.total,
      passed: input.passed,
      answers: input.answers,
      churchId: input.churchId,
    });
    const updated = await tx
      .update(guideProgress)
      .set({
        attempts: sql`${guideProgress.attempts} + 1`,
        bestScore: sql`greatest(coalesce(${guideProgress.bestScore}, 0), ${pct})`,
        // A failed retake never clears a pass: coalesce keeps the first one.
        passedAt: sql`coalesce(${guideProgress.passedAt}, ${input.passed ? sql`now()` : sql`null`})`,
      })
      .where(and(eq(guideProgress.userId, input.userId), eq(guideProgress.guideSlug, input.slug)))
      .returning({ slug: guideProgress.guideSlug });
    // The action checked for the row before grading, so a miss here is a bug,
    // and rolling the attempt back with it keeps the evidence honest.
    if (updated.length !== 1) throw new Error(`guide_progress row missing for ${input.slug}`);
  });
}

/* ------------------------------------------------------------------ *
 * Use
 * ------------------------------------------------------------------ */

/** Each person's standing, from the durable day table. Weeks are counted in JS. */
export async function standingFor(userIds: string[]): Promise<Map<string, Standing>> {
  const days = new Map<string, string[]>();
  for (const part of chunks([...new Set(userIds)])) {
    const rows = await db
      .select({ userId: userActiveDay.userId, day: userActiveDay.day })
      .from(userActiveDay)
      .where(inArray(userActiveDay.userId, part));
    for (const r of rows) {
      const list = days.get(r.userId) ?? [];
      list.push(r.day);
      days.set(r.userId, list);
    }
  }
  const out = new Map<string, Standing>();
  for (const id of userIds) out.set(id, activeStanding(days.get(id) ?? []));
  return out;
}

/* ------------------------------------------------------------------ *
 * Certificates
 * ------------------------------------------------------------------ */

/**
 * Issue every rank this person has earned and does not yet have a row for.
 * Returns only the ranks issued by THIS call.
 *
 * Issuing once is enforced by the unique (user_id, rank) index: the insert is
 * ON CONFLICT DO NOTHING RETURNING, so a quiz pass and the nightly cron
 * deciding the same thing at the same moment produce one certificate, and the
 * one that lost the race simply gets no row back. A revoked row keeps its
 * slot, so a withdrawn rank is never quietly re-issued here.
 *
 * `via.churchId` is the church the person was signed in to when a quiz issued
 * it; null when the cron did.
 */
export async function issueEarnedCertificates(
  userId: string,
  via: { churchId: string | null },
): Promise<CertRank[]> {
  const [progress, certs, standings, [person]] = await Promise.all([
    listProgress(userId),
    listCertificates(userId),
    standingFor([userId]),
    db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, userId)).limit(1),
  ]);
  if (!person) return [];
  // A withdrawn Professional ends the ladder. Without this, the next passing
  // retake would still count "every module passed" and issue Master or Expert
  // on top of the certificate that was taken away.
  if (certs.some((c) => c.rank === "professional" && c.revokedAt)) return [];

  const passed =new Set(progress.filter((p) => p.passedAt).map((p) => p.guideSlug));
  const standing = standings.get(userId) ?? EMPTY_STANDING;
  const earned = ranksEarned({
    holdsProfessional: certs.some((c) => c.rank === "professional" && !c.revokedAt),
    allModulesPassed: CURRICULUM.every((slug) => passed.has(slug)),
    standing,
  });

  const name = person.name?.trim() || person.email;
  const issued: CertRank[] = [];

  for (const rank of earned) {
    if (certs.some((c) => c.rank === rank)) continue;
    const row = await insertCertificate({ userId, rank, name, weeks: standing.weeks });
    if (!row) continue;
    issued.push(rank);

    const label = rankInfo(rank).label;
    const entry = {
      action: "training.certification.create",
      summary: `${name} earned ${label}`,
      targetType: "user",
      targetId: userId,
      targetLabel: name,
      meta: { rank, code: row.code },
    };
    if (via.churchId) await audit({ churchId: via.churchId, ...entry });
    else await auditSystem({ actorName: "Certification", churchId: null, ...entry });

    await notifyUser({
      userId,
      title: `You are now ${label}`,
      body: "Your certificate is ready to download.",
      linkUrl: "/help/course",
    });
  }
  return issued;
}

/**
 * One certificate row, or null when the (user, rank) slot was already taken.
 * A clash on the CODE (23^8 of them, so very rare) is retried with a fresh
 * one, three times; anything else is rethrown.
 */
async function insertCertificate(input: {
  userId: string;
  rank: CertRank;
  name: string;
  weeks: number;
}): Promise<{ id: string; code: string } | null> {
  for (let attempt = 1; ; attempt++) {
    const code = generateCertCode();
    try {
      const [row] = await db
        .insert(platformCertificate)
        .values({
          userId: input.userId,
          rank: input.rank,
          code,
          holderName: input.name,
          activeWeeksAtIssue: input.weeks,
          modulesAtIssue: CURRICULUM,
        })
        .onConflictDoNothing({ target: [platformCertificate.userId, platformCertificate.rank] })
        .returning({ id: platformCertificate.id, code: platformCertificate.code });
      return row ?? null;
    } catch (e) {
      if (attempt < 3 && isUniqueViolation(e, "platform_certificate_code_idx")) continue;
      throw e;
    }
  }
}

/**
 * The highest rank each of these people holds, for the chip beside a name.
 * Only the rank and its date: nothing about scores, attempts or progress.
 */
export async function ranksForUsers(
  userIds: string[],
): Promise<Map<string, { rank: CertRank; issuedAt: Date }>> {
  const out = new Map<string, { rank: CertRank; issuedAt: Date }>();
  for (const part of chunks([...new Set(userIds)])) {
    const rows = await db
      .select({
        userId: platformCertificate.userId,
        rank: platformCertificate.rank,
        issuedAt: platformCertificate.issuedAt,
      })
      .from(platformCertificate)
      .where(and(inArray(platformCertificate.userId, part), isNull(platformCertificate.revokedAt)));
    for (const r of rows) {
      const current = out.get(r.userId);
      if (!current || highestRank([current.rank, r.rank]) === r.rank) {
        out.set(r.userId, { rank: r.rank, issuedAt: r.issuedAt });
      }
    }
  }
  return out;
}

export async function getCertificate(userId: string, rank: CertRank): Promise<CertificateRow | null> {
  const [row] = await db
    .select()
    .from(platformCertificate)
    .where(and(eq(platformCertificate.userId, userId), eq(platformCertificate.rank, rank)))
    .limit(1);
  return row ?? null;
}

/**
 * What the public verification page may show, and nothing else: no user id,
 * no email, no church, no scores.
 */
export async function getCertificateByCode(code: string): Promise<{
  holderName: string;
  rank: CertRank;
  issuedAt: Date;
  revokedAt: Date | null;
  modulesCount: number;
} | null> {
  const [row] = await db
    .select({
      holderName: platformCertificate.holderName,
      rank: platformCertificate.rank,
      issuedAt: platformCertificate.issuedAt,
      revokedAt: platformCertificate.revokedAt,
      modulesAtIssue: platformCertificate.modulesAtIssue,
    })
    .from(platformCertificate)
    .where(eq(platformCertificate.code, code))
    .limit(1);
  if (!row) return null;
  return {
    holderName: row.holderName,
    rank: row.rank,
    issuedAt: row.issuedAt,
    revokedAt: row.revokedAt,
    modulesCount: row.modulesAtIssue.length,
  };
}
