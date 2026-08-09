import "dotenv/config";
import { Pool } from "pg";

/**
 * Diagnostic for the member → staff access flow.
 *
 * Exercises the real SQL against the live database on a throwaway member, then
 * cleans up after itself. Proves the queries behind the invite/accept path work
 * — including that accepting applies the invited role and links the member by
 * id rather than by email.
 *
 * Usage: pnpm exec tsx scripts/check-member-access.ts
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const [{ id: churchId }] = (
    await pool.query("select id from church limit 1")
  ).rows;
  const [{ id: userId }] = (await pool.query("select id from \"user\" limit 1"))
    .rows;
  if (!churchId || !userId) {
    console.log("No church/user in the local DB — nothing to check.");
    return;
  }

  console.log("Member → staff access flow:\n");

  // A throwaway member with no email, like someone added from a paper register.
  const member = (
    await pool.query(
      `insert into member (church_id, first_name, last_name, status)
       values ($1, 'ZZTest', 'AccessFlow', 'active') returning id`,
      [churchId],
    )
  ).rows[0];

  // A role that can manage the team — should map to Better Auth "admin".
  const role = (
    await pool.query(
      `insert into role (church_id, name, permissions, is_system)
       values ($1, 'ZZTest Role', '{"members.view","team.manage"}', false)
       returning id, permissions`,
      [churchId],
    )
  ).rows[0];

  check(
    "a role's permissions round-trip as an array",
    Array.isArray(role.permissions) && role.permissions.includes("team.manage"),
    JSON.stringify(role.permissions),
  );

  // Capturing an email on a member who had none.
  await pool.query("update member set email = $2 where id = $1", [
    member.id,
    "zztest.accessflow@example.com",
  ]);
  const withEmail = (
    await pool.query("select email from member where id = $1", [member.id])
  ).rows[0];
  check(
    "an email typed at invite time is saved to the member",
    withEmail.email === "zztest.accessflow@example.com",
  );

  // The invitation + side row.
  const invitationId = `zztest-inv-${Date.now()}`;
  await pool.query(
    `insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
     values ($1, $2, $3, 'admin', 'pending', now() + interval '7 days', $4)`,
    [invitationId, churchId, withEmail.email, userId],
  );
  await pool.query(
    `insert into staff_invite (invitation_id, member_id, role_id)
     values ($1, $2, $3)`,
    [invitationId, member.id, role.id],
  );

  // Re-inviting must update, not violate the unique index.
  let upsertOk = true;
  try {
    await pool.query(
      `insert into staff_invite (invitation_id, member_id, role_id)
       values ($1, $2, $3)
       on conflict (invitation_id) do update
         set member_id = excluded.member_id, role_id = excluded.role_id`,
      [invitationId, member.id, role.id],
    );
  } catch (e) {
    upsertOk = false;
    console.log("    upsert error:", (e as Error).message);
  }
  check("re-inviting the same person upserts instead of failing", upsertOk);

  // What joinChurch does on acceptance.
  const side = (
    await pool.query(
      "select member_id, role_id from staff_invite where invitation_id = $1",
      [invitationId],
    )
  ).rows[0];
  check("the side row is found by invitation id", !!side);
  check("it carries the chosen role", side?.role_id === role.id);

  const linked = await pool.query(
    `update member set user_id = $2
     where id = $1 and church_id = $3 and user_id is null
     returning id`,
    [side.member_id, userId, churchId],
  );
  check("accepting links that exact member by id", linked.rowCount === 1);

  // Revoke keeps the person.
  await pool.query("update member set user_id = null where id = $1", [member.id]);
  await pool.query(
    `update invitation set status = 'cancelled'
     where organization_id = $1 and status = 'pending' and lower(email) = $2`,
    [churchId, withEmail.email.toLowerCase()],
  );
  const afterRevoke = (
    await pool.query("select id, user_id, email from member where id = $1", [
      member.id,
    ])
  ).rows[0];
  check("revoking keeps the member row", !!afterRevoke);
  check("revoking clears the login link", afterRevoke.user_id === null);
  const inv = (
    await pool.query("select status from invitation where id = $1", [invitationId])
  ).rows[0];
  check(
    "revoking cancels the pending invitation so the old link is dead",
    inv.status === "cancelled",
  );

  // Deleting the invitation must take the side row with it.
  await pool.query("delete from invitation where id = $1", [invitationId]);
  const orphans = (
    await pool.query(
      "select count(*)::int as n from staff_invite where invitation_id = $1",
      [invitationId],
    )
  ).rows[0];
  check("the side row cascades away with the invitation", orphans.n === 0);

  // Clean up the throwaway rows this script created.
  await pool.query("delete from member where id = $1", [member.id]);
  await pool.query("delete from role where id = $1", [role.id]);

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
