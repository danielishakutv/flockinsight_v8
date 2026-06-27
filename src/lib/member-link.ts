import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { member, user } from "@/db/schema";

/**
 * Ensure a `member` profile exists for a login account within a church and is
 * linked to it — so a staff member isn't duplicated as a separate person.
 *
 *   - already linked → no-op
 *   - an unlinked member with the same email exists → link it
 *   - otherwise → create a member from the user's name & email
 *
 * Never throws (a failure here must not block joining a church).
 */
export async function ensureMemberForUser(
  churchId: string,
  userId: string,
): Promise<void> {
  try {
    const [linked] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.churchId, churchId), eq(member.userId, userId)))
      .limit(1);
    if (linked) return;

    const [u] = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!u) return;

    if (u.email) {
      const [match] = await db
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.churchId, churchId),
            isNull(member.userId),
            sql`lower(${member.email}) = ${u.email.toLowerCase()}`,
          ),
        )
        .limit(1);
      if (match) {
        await db
          .update(member)
          .set({ userId })
          .where(eq(member.id, match.id));
        return;
      }
    }

    const parts = (u.name || "").trim().split(/\s+/).filter(Boolean);
    const firstName = parts[0] || u.email?.split("@")[0] || "Member";
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
    await db
      .insert(member)
      .values({
        churchId,
        firstName: firstName.slice(0, 80),
        lastName: lastName ? lastName.slice(0, 80) : null,
        email: u.email,
        status: "active",
        userId,
        createdBy: userId,
      })
      .onConflictDoNothing();
  } catch (e) {
    console.error("[member-link] ensureMemberForUser failed", e);
  }
}
