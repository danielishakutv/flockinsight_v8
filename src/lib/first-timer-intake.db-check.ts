/**
 * First-timer intake, against a real database. Run with `pnpm test:db`.
 *
 * Mostly a security test. Two findings came out of the review of this module
 * and both were real, and both are the kind that a type checker and a unit
 * test cannot see because they are about WHICH ROW gets written:
 *
 *   1. `invitedById` was validated as a uuid but never checked to belong to
 *      the church doing the writing, and the joins that read it back were not
 *      church-scoped — so another church's member name could be printed on
 *      this church's page and in its CSV export.
 *
 *   2. The public link patched existing members. Matching is on phone number
 *      and email, neither of which is a secret, so anybody who knew a
 *      member's number could type it into a church's public welcome form and
 *      have their own email and address written into that member's record
 *      wherever the church had left a blank.
 *
 * Creates two churches of its own and removes exactly what it created. It
 * never reads or writes a row it did not make.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, member } from "@/db/schema";
import { registerFirstTimer, listFirstTimers } from "@/lib/first-timer-intake";

const stamp = Date.now();
const ours = `ft-check-a-${stamp}`;
const theirs = `ft-check-b-${stamp}`;
const memberIds: string[] = [];

/** A member of the OTHER church, to aim a cross-tenant reference at. */
let foreignMemberId = "";
/** Somebody already on our register, with blanks, to try to overwrite. */
let existingId = "";
const existingPhone = `0809${String(stamp).slice(-7)}`;

beforeAll(async () => {
  for (const [id, name] of [
    [ours, "FT Check Church A"],
    [theirs, "FT Check Church B"],
  ]) {
    await db
      .insert(church)
      .values({ id, name, slug: id, currency: "NGN" })
      .onConflictDoNothing();
  }

  const [foreign] = await db
    .insert(member)
    .values({ churchId: theirs, firstName: "Foreign", lastName: "Inviter" })
    .returning({ id: member.id });
  foreignMemberId = foreign.id;
  memberIds.push(foreign.id);

  const [existing] = await db
    .insert(member)
    .values({
      churchId: ours,
      firstName: "Already",
      lastName: "Known",
      phone: existingPhone,
      status: "active",
      // Deliberately blank: these are what an attacker would try to fill.
      email: null,
      address: null,
      notes: null,
    })
    .returning({ id: member.id });
  existingId = existing.id;
  memberIds.push(existing.id);
});

afterAll(async () => {
  if (memberIds.length > 0) {
    await db.delete(member).where(inArray(member.id, memberIds));
  }
  await db.delete(church).where(inArray(church.id, [ours, theirs]));
});

async function register(
  intake: Parameters<typeof registerFirstTimer>[0]["intake"],
  extra: Partial<Parameters<typeof registerFirstTimer>[0]> = {},
) {
  const res = await registerFirstTimer({ churchId: ours, intake, ...extra });
  if (!res.ok) throw new Error(res.error);
  if (res.result.outcome === "created") memberIds.push(res.result.memberId);
  return res.result;
}

describe("what a first-timer is written as", () => {
  it("is a visitor in follow-up, with no joined date", async () => {
    const r = await register({ firstName: "Grace", phone: "08100000001" });
    expect(r.outcome).toBe("created");

    const [row] = await db
      .select()
      .from(member)
      .where(eq(member.id, r.memberId))
      .limit(1);

    expect(row.status).toBe("visitor");
    expect(row.inFollowUp).toBe(true);
    expect(row.followUpStatus).toBe("new");
    // A first-timer has not joined. Conflating the two is what makes a
    // visitor look like a member in every count that reads joinedAt.
    expect(row.joinedAt).toBeNull();
    expect(row.firstVisitDate).not.toBeNull();
  });
});

describe("the inviter cannot come from another church", () => {
  it("drops a cross-tenant id instead of writing the reference", async () => {
    const r = await register({
      firstName: "Crosstenant",
      phone: "08100000002",
      invitedById: foreignMemberId,
      invitedByName: "typed fallback",
    });

    const [row] = await db
      .select({
        invitedById: member.invitedById,
        invitedByName: member.invitedByName,
      })
      .from(member)
      .where(eq(member.id, r.memberId))
      .limit(1);

    expect(row.invitedById).toBeNull();
    // Nothing is lost: the typed name survives the id being refused.
    expect(row.invitedByName).toBe("typed fallback");
  });

  it("keeps an inviter who really is one of ours", async () => {
    const r = await register({
      firstName: "Properly",
      phone: "08100000003",
      invitedById: existingId,
    });

    const [row] = await db
      .select({ invitedById: member.invitedById })
      .from(member)
      .where(eq(member.id, r.memberId))
      .limit(1);

    expect(row.invitedById).toBe(existingId);
  });

  it("never reads another church's name back, even from a row that has one", async () => {
    // Write the cross-tenant reference directly, as a row from before the
    // check existed would look, and prove the READ side refuses it too.
    const [planted] = await db
      .insert(member)
      .values({
        churchId: ours,
        firstName: "Planted",
        status: "visitor",
        invitedById: foreignMemberId,
      })
      .returning({ id: member.id });
    memberIds.push(planted.id);

    const rows = await listFirstTimers(ours);
    const found = rows.find((r) => r.id === planted.id);

    expect(found).toBeDefined();
    expect(found?.inviterFirstName).toBeNull();
    expect(found?.inviterLastName).toBeNull();
  });
});

describe("somebody already on the register", () => {
  it("is never duplicated when the phone number matches", async () => {
    const r = await register({
      firstName: "Already",
      lastName: "Known",
      phone: existingPhone,
    });
    expect(r.outcome).toBe("matched");
    expect(r.memberId).toBe(existingId);
  });

  it("keeps their status — a member who fills in a card is still a member", async () => {
    await register({ firstName: "Already", phone: existingPhone });
    const [row] = await db
      .select({ status: member.status })
      .from(member)
      .where(eq(member.id, existingId))
      .limit(1);
    // Demoting them would drop them out of the membership count and post them
    // a stranger's welcome message.
    expect(row.status).toBe("active");
  });

  it("lets a signed-in member of staff fill in a blank", async () => {
    await register(
      { firstName: "Already", phone: existingPhone, email: "staff-filled@example.com" },
      { allowPatchExisting: true },
    );
    const [row] = await db
      .select({ email: member.email })
      .from(member)
      .where(eq(member.id, existingId))
      .limit(1);
    expect(row.email).toBe("staff-filled@example.com");
  });

  it("does NOT let the public link fill one in", async () => {
    // The finding, as a test. Knowing the phone number must not be enough to
    // write anything into somebody else's record.
    const before = await db
      .select({ address: member.address, notes: member.notes })
      .from(member)
      .where(eq(member.id, existingId))
      .limit(1);

    const r = await register(
      {
        firstName: "Attacker",
        phone: existingPhone,
        address: "17 Somewhere Else",
        notes: "injected",
      },
      { allowPatchExisting: false, createdBy: null },
    );
    expect(r.outcome).toBe("matched");

    const [after] = await db
      .select({ address: member.address, notes: member.notes })
      .from(member)
      .where(eq(member.id, existingId))
      .limit(1);

    expect(after.address).toBe(before[0].address);
    expect(after.notes).toBe(before[0].notes);
  });

  it("still flags them for follow-up, which is the one thing it may do", async () => {
    await db
      .update(member)
      .set({ inFollowUp: false, followUpStatus: null })
      .where(eq(member.id, existingId));

    await register(
      { firstName: "Visitor", phone: existingPhone },
      { allowPatchExisting: false, createdBy: null },
    );

    const [row] = await db
      .select({
        inFollowUp: member.inFollowUp,
        followUpStatus: member.followUpStatus,
      })
      .from(member)
      .where(eq(member.id, existingId))
      .limit(1);

    expect(row.inFollowUp).toBe(true);
    expect(row.followUpStatus).toBe("new");
  });
});

describe("tenancy of the list itself", () => {
  it("never shows another church's people", async () => {
    await db.insert(member).values({
      churchId: theirs,
      firstName: "Their",
      lastName: "Visitor",
      status: "visitor",
    });
    const planted = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.churchId, theirs));
    memberIds.push(...planted.map((p) => p.id));

    const rows = await listFirstTimers(ours);
    const leaked = rows.filter((r) => planted.some((p) => p.id === r.id));
    expect(leaked).toEqual([]);
  });
});
