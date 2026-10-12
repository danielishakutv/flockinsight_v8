/**
 * People in churches outside Nigeria, against a real database. Run with
 * `pnpm test:db`.
 *
 * What a unit test of the phone helpers cannot see is the SQL half: that
 * `findExistingMember` really matches a Mozambican number stored one way when
 * it is typed another, and that a first-timer coming back on a second Sunday
 * is recognised rather than written down twice. And that deleting the member
 * who invited a first-timer leaves the inviter's name behind.
 *
 * Creates its own churches (ids prefixed "zzcheck-") and removes exactly the
 * rows it created, by id. It never reads or writes a row it did not make.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, member } from "@/db/schema";
import { findExistingMember } from "@/lib/member-signup";
import { preserveInviterNames, registerFirstTimer } from "@/lib/first-timer-intake";

const stamp = Date.now();
const maputo = `zzcheck-mz-${stamp}`;
const lagos = `zzcheck-ng-${stamp}`;
const memberIds: string[] = [];
// Unique per run, so a leftover from a crashed run can never be matched.
const tail = String(stamp).slice(-7);
const mzLocal = `84 ${tail.slice(0, 3)} ${tail.slice(3)}`; // 9 digits, as written in Maputo
const ngLocal = `0803${tail}`;

let mzMemberId = "";
let ngMemberId = "";

beforeAll(async () => {
  await db
    .insert(church)
    .values([
      { id: maputo, name: "ZZ Check Maputo", slug: maputo, country: "Mozambique", currency: "MZN", timezone: "Africa/Maputo" },
      { id: lagos, name: "ZZ Check Lagos", slug: lagos, country: "Nigeria", currency: "NGN" },
    ])
    .onConflictDoNothing();

  const [mz] = await db
    .insert(member)
    .values({ churchId: maputo, firstName: "Ana", phone: mzLocal, status: "active" })
    .returning({ id: member.id });
  mzMemberId = mz.id;
  memberIds.push(mz.id);

  const [ng] = await db
    .insert(member)
    .values({ churchId: lagos, firstName: "Ada", phone: ngLocal, status: "active" })
    .returning({ id: member.id });
  ngMemberId = ng.id;
  memberIds.push(ng.id);
});

afterAll(async () => {
  if (memberIds.length > 0) await db.delete(member).where(inArray(member.id, memberIds));
  await db.delete(church).where(inArray(church.id, [maputo, lagos]));
});

describe("findExistingMember reads a number with the church's own dial code", () => {
  it("matches a Mozambican number however it is typed", async () => {
    for (const typed of [mzLocal, `+258 ${mzLocal}`, `0${mzLocal}`, `258${mzLocal.replace(/\D/g, "")}`]) {
      const found = await findExistingMember(maputo, null, typed);
      expect(found?.id, typed).toBe(mzMemberId);
    }
  });

  it("still matches a Nigerian number the way it always did", async () => {
    const found = await findExistingMember(lagos, null, `+234 803 ${tail}`);
    expect(found?.id).toBe(ngMemberId);
  });

  it("does not match the same digits in another church", async () => {
    expect(await findExistingMember(lagos, null, `+258 ${mzLocal}`)).toBeNull();
  });
});

describe("a first-timer abroad", () => {
  it("is stored in E.164 and recognised on their second Sunday", async () => {
    const local = `86 ${tail.slice(0, 3)} ${tail.slice(3)}`;
    const first = await registerFirstTimer({
      churchId: maputo,
      intake: { firstName: "Bento", phone: local },
    });
    if (!first.ok) throw new Error(first.error);
    expect(first.result.outcome).toBe("created");
    memberIds.push(first.result.memberId);

    const [row] = await db
      .select({ phone: member.phone })
      .from(member)
      .where(eq(member.id, first.result.memberId));
    expect(row.phone).toBe(`+25886${tail}`);

    const again = await registerFirstTimer({
      churchId: maputo,
      intake: { firstName: "Bento", phone: `+258 ${local}` },
    });
    if (!again.ok) throw new Error(again.error);
    expect(again.result.outcome).toBe("matched");
    expect(again.result.memberId).toBe(first.result.memberId);
  });
});

describe("deleting an inviter", () => {
  it("leaves their name on the first-timers they brought", async () => {
    const [inviter] = await db
      .insert(member)
      .values({ churchId: lagos, firstName: "Inviting", lastName: "Deacon" })
      .returning({ id: member.id });
    memberIds.push(inviter.id);
    const [guest] = await db
      .insert(member)
      .values({ churchId: lagos, firstName: "Guest", status: "visitor", invitedById: inviter.id })
      .returning({ id: member.id });
    memberIds.push(guest.id);

    await db.transaction(async (tx) => {
      await preserveInviterNames(tx, lagos, [inviter.id]);
      await tx.delete(member).where(eq(member.id, inviter.id));
    });

    const [after] = await db
      .select({ invitedById: member.invitedById, invitedByName: member.invitedByName })
      .from(member)
      .where(eq(member.id, guest.id));
    expect(after.invitedById).toBeNull();
    expect(after.invitedByName).toBe("Inviting Deacon");
  });
});
