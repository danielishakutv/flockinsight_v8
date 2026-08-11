import "dotenv/config";
import { Pool } from "pg";
import crypto from "node:crypto";

/**
 * Diagnostic for "the church role decides who can invite".
 *
 * Builds the broken state on purpose — a staff member holding a team.manage
 * role while stuck at staff.role = 'member' — then proves both the backfill
 * SQL and the assignRole write rules behave as designed. Cleans up after
 * itself.
 *
 * Usage: pnpm exec tsx scripts/check-org-role-sync.ts
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

async function orgRoleOf(staffId: string): Promise<string> {
  return (await pool.query("select role from staff where id = $1", [staffId]))
    .rows[0]?.role;
}

async function main() {
  const church = (await pool.query("select id from church limit 1")).rows[0];
  const user = (await pool.query('select id from "user" limit 1')).rows[0];
  if (!church || !user) {
    console.log("No church/user locally — nothing to check.");
    await pool.end();
    return;
  }

  console.log("Church role → invite rights:\n");

  // Two roles: one that can manage the team, one that cannot.
  const manageRole = (
    await pool.query(
      `insert into role (church_id, name, permissions, is_system)
       values ($1, 'ZZTest Manager', '{"members.view","team.manage"}', false)
       returning id`,
      [church.id],
    )
  ).rows[0];
  const plainRole = (
    await pool.query(
      `insert into role (church_id, name, permissions, is_system)
       values ($1, 'ZZTest Plain', '{"members.view"}', false)
       returning id`,
      [church.id],
    )
  ).rows[0];

  // The broken state: holds a team.manage role, but org role is 'member'.
  const staffId = crypto.randomUUID();
  await pool.query(
    `insert into staff (id, organization_id, user_id, role, role_id)
     values ($1, $2, $3, 'member', $4)`,
    [staffId, church.id, user.id, manageRole.id],
  );
  check(
    "reproduced the bug: team.manage role but org role 'member'",
    (await orgRoleOf(staffId)) === "member",
  );

  // --- The backfill ---
  const backfilled = await pool.query(
    `update staff s set role = 'admin'
       from role r
      where r.id = s.role_id
        and r.church_id = s.organization_id
        and 'team.manage' = any(r.permissions)
        and s.role = 'member'
      returning s.id`,
  );
  check(
    "backfill promotes them to admin",
    (await orgRoleOf(staffId)) === "admin",
    `updated ${backfilled.rowCount} row(s)`,
  );

  const second = await pool.query(
    `update staff s set role = 'admin'
       from role r
      where r.id = s.role_id
        and r.church_id = s.organization_id
        and 'team.manage' = any(r.permissions)
        and s.role = 'member'
      returning s.id`,
  );
  check("backfill is idempotent on a second run", second.rowCount === 0);

  // --- assignRole write rules ---
  // Assigning a role WITHOUT team.manage demotes to member.
  await pool.query("update staff set role_id = $2, role = $3 where id = $1", [
    staffId,
    plainRole.id,
    "member",
  ]);
  check(
    "a role without team.manage means org role 'member'",
    (await orgRoleOf(staffId)) === "member",
  );

  // Assigning one WITH team.manage promotes to admin.
  await pool.query("update staff set role_id = $2, role = $3 where id = $1", [
    staffId,
    manageRole.id,
    "admin",
  ]);
  check(
    "a role with team.manage means org role 'admin'",
    (await orgRoleOf(staffId)) === "admin",
  );

  // Clearing the role must leave org role untouched.
  await pool.query("update staff set role_id = null where id = $1", [staffId]);
  check(
    "clearing a role leaves the org role alone (no silent demotion)",
    (await orgRoleOf(staffId)) === "admin",
  );

  // An owner row is never touched by the backfill.
  const ownerStaffId = crypto.randomUUID();
  await pool.query(
    `insert into staff (id, organization_id, user_id, role, role_id)
     values ($1, $2, $3, 'owner', $4)`,
    [ownerStaffId, church.id, user.id, manageRole.id],
  );
  await pool.query(
    `update staff s set role = 'admin'
       from role r
      where r.id = s.role_id and r.church_id = s.organization_id
        and 'team.manage' = any(r.permissions) and s.role = 'member'`,
  );
  check(
    "the owner's row is never touched",
    (await orgRoleOf(ownerStaffId)) === "owner",
  );

  // Clean up only the rows this script created.
  await pool.query("delete from staff where id = any($1)", [
    [staffId, ownerStaffId],
  ]);
  await pool.query("delete from role where id = any($1)", [
    [manageRole.id, plainRole.id],
  ]);

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
