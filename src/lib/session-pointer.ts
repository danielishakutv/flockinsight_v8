import { and, eq, notInArray, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { session, staff } from "@/db/schema";

/**
 * Re-aim a person's sessions when they lose a church.
 *
 * Three places take somebody out of a church and must stop their sessions
 * pointing at it: revoking a member's app access, the org plugin's
 * remove-member, and taking platform access away from an admin who was acting
 * as a church. All three used to write NULL. But `requireChurch()` reads a
 * null pointer as "has no church" and sends them to /onboarding — "Create your
 * church" — even when they belong to another one. A volunteer removed from one
 * of their two churches, or an offboarded operator who is also a pastor
 * somewhere (the normal case: acting as a church points EVERY one of their
 * sessions at it), was invited to make a duplicate church with a fresh trial.
 *
 * So the pointer moves to the oldest church they still genuinely belong to
 * (never a `temp` impersonation seat), the same choice the sign-in hook makes,
 * and is null only when there is none left.
 *
 * Run it AFTER the seat has been removed, in the same transaction, so the
 * church being left is not chosen again.
 */

type DbOrTx =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The oldest church this person holds a real seat in, or null. */
export async function firstRealChurchOf(
  tx: DbOrTx,
  userId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: staff.organizationId })
    .from(staff)
    .where(and(eq(staff.userId, userId), eq(staff.temp, false)))
    .orderBy(staff.createdAt)
    .limit(1);
  return row?.id ?? null;
}

/**
 * Sessions aimed at `fromChurchId` move to a church the person still belongs
 * to. Returns the church they now point at (null: none left).
 */
export async function repointSessionsLeaving(
  tx: DbOrTx,
  userId: string,
  fromChurchId: string,
): Promise<string | null> {
  return repoint(
    tx,
    userId,
    eq(session.activeOrganizationId, fromChurchId),
  );
}

/**
 * Every session aimed anywhere the person does not genuinely belong moves to
 * a church they do. For ending platform access: an impersonation may have
 * pointed sessions at any number of churches.
 */
export async function repointSessionsToOwnChurch(
  tx: DbOrTx,
  userId: string,
): Promise<string | null> {
  const own = await tx
    .select({ id: staff.organizationId })
    .from(staff)
    .where(and(eq(staff.userId, userId), eq(staff.temp, false)));
  const ownIds = own.map((r) => r.id);
  return repoint(
    tx,
    userId,
    ownIds.length > 0
      ? notInArray(session.activeOrganizationId, ownIds)
      : undefined,
  );
}

async function repoint(
  tx: DbOrTx,
  userId: string,
  which: SQL | undefined,
): Promise<string | null> {
  const next = await firstRealChurchOf(tx, userId);
  await tx
    .update(session)
    .set({ activeOrganizationId: next })
    .where(which ? and(eq(session.userId, userId), which) : eq(session.userId, userId));
  return next;
}
