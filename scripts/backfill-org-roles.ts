import "dotenv/config";
import { Pool } from "pg";

/**
 * One-off repair: promote staff who already hold a church role granting
 * `team.manage` but are stuck at `staff.role = 'member'`.
 *
 * Those people can open Settings → Team (the page checks the church
 * permission) and then have their invite rejected by Better Auth, which checks
 * the org role. Assigning a role used to write only `staff.roleId`, so the two
 * could never agree.
 *
 * Only ever promotes. An existing org admin is never demoted here: they may
 * have no church role at all and be relying on the full-access fallback in
 * lib/permissions.ts, so demoting them would take access away.
 *
 * Safe to run more than once — a second run reports 0.
 *
 * Usage: pnpm exec tsx scripts/backfill-org-roles.ts
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(`
    update staff s
       set role = 'admin'
      from role r
     where r.id = s.role_id
       and r.church_id = s.organization_id
       and 'team.manage' = any(r.permissions)
       and s.role = 'member'
    returning s.id, s.organization_id, s.user_id, r.name as role_name
  `);

  if (rows.length === 0) {
    console.log("Nothing to fix — every team-managing role already has the org role.");
  } else {
    console.log(`Promoted ${rows.length} staff member(s) to org admin:`);
    for (const r of rows) {
      console.log(
        `  church ${r.organization_id} · user ${r.user_id} · role "${r.role_name}"`,
      );
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
