import "dotenv/config";
import { Pool } from "pg";

/**
 * One-off repair: staff left as "admin with no church role" by the role bug.
 *
 * `staff.role_id` (and `staff_invite.role_id`) are ON DELETE SET NULL, and
 * `staff.role = 'admin'` with no role is the legacy full-access fallback in
 * lib/staff-permissions.ts. Until the fix in lib/role-sync.ts:
 *
 * - deleting a church role whose permissions included "Manage team" left every
 *   holder as admin-with-no-role — full access, while the audit line said
 *   "dropped to the basics";
 * - clearing somebody's role (Team → Role → none) did the same;
 * - an invitation raised for such a role and accepted after the role was
 *   deleted arrived as admin-with-no-role.
 *
 * The fix stops new ones. This finds the ones already made. A genuine legacy
 * admin (invited as "admin" before church roles existed) looks identical in
 * the staff table, so each candidate is listed WITH THE EVIDENCE that they
 * once held a church role, and only evidence-backed rows are touched:
 *
 *   strong  — an audit row putting them on a role (team.member.grant), or
 *             clearing a role they had (team.member.revoke with a
 *             previousRoleId), or an accepted staff_invite whose role has
 *             since been deleted. They were on a role; they are not legacy.
 *   weak    — only that a role was deleted in their church after they joined.
 *             Listed for a human to judge; touched only with --include-weak.
 *
 * Also lists pending invitations still carrying "admin" whose role has been
 * deleted (staff_invite.role_id null): accepting one would make the same kind
 * of row. --apply drops those to "member" too; nobody holds them yet.
 *
 * Dry run by default — it prints and changes nothing. Rehearse on a scratch
 * restore first (see the server-access notes), then:
 *
 *   pnpm exec tsx scripts/repair-deleted-role-admins.ts            # report
 *   pnpm exec tsx scripts/repair-deleted-role-admins.ts --apply    # strong only
 *   pnpm exec tsx scripts/repair-deleted-role-admins.ts --apply --include-weak
 *
 * Demoting writes role = 'member' and nothing else: the person keeps their
 * seat, their member profile and everything they did. An owner can put them
 * back on the right role from Settings → Team. Every change is recorded in the
 * church's audit log as a system action. Safe to run more than once.
 */

const APPLY = process.argv.includes("--apply");
const INCLUDE_WEAK = process.argv.includes("--include-weak");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type Candidate = {
  staff_id: string;
  church_id: string;
  church_name: string | null;
  user_id: string;
  email: string | null;
  joined: Date;
  granted: boolean;
  cleared: boolean;
  invited_onto_deleted_role: boolean;
  role_deleted_after_join: boolean;
};

async function main() {
  const { rows } = await pool.query<Candidate>(`
    select s.id                as staff_id,
           s.organization_id   as church_id,
           c.name              as church_name,
           s.user_id,
           u.email,
           s.created_at        as joined,
           exists (
             select 1 from audit_log a
              where a.church_id = s.organization_id
                and a.action = 'team.member.grant'
                and a.target_type = 'staff'
                and a.target_id = s.id
           ) as granted,
           exists (
             select 1 from audit_log a
              where a.church_id = s.organization_id
                and a.action = 'team.member.revoke'
                and a.target_type = 'staff'
                and a.target_id = s.id
                and coalesce(a.meta->>'previousRoleId', '') <> ''
           ) as cleared,
           exists (
             select 1 from staff_invite si
               join invitation i on i.id = si.invitation_id
              where i.organization_id = s.organization_id
                and lower(i.email) = lower(u.email)
                and i.status = 'accepted'
                and si.role_id is null
           ) as invited_onto_deleted_role,
           exists (
             select 1 from audit_log a
              where a.church_id = s.organization_id
                and a.action = 'team.role.revoke'
                and a.target_type = 'role'
                and a.created_at > s.created_at
           ) as role_deleted_after_join
      from staff s
      join "user" u on u.id = s.user_id
      left join church c on c.id = s.organization_id
     where s.role = 'admin'
       and s.role_id is null
       and s.temp = false
     order by c.name, u.email
  `);

  const strong = rows.filter(
    (r) => r.granted || r.cleared || r.invited_onto_deleted_role,
  );
  const weak = rows.filter(
    (r) =>
      !(r.granted || r.cleared || r.invited_onto_deleted_role) &&
      r.role_deleted_after_join,
  );
  const legacy = rows.length - strong.length - weak.length;

  const { rows: invites } = await pool.query<{
    id: string;
    church_id: string;
    email: string;
  }>(`
    select i.id, i.organization_id as church_id, i.email
      from invitation i
      join staff_invite si on si.invitation_id = i.id
     where i.status = 'pending'
       and i.role = 'admin'
       and si.role_id is null
  `);

  const why = (r: Candidate) =>
    [
      r.granted && "was put on a role",
      r.cleared && "had a role cleared",
      r.invited_onto_deleted_role && "accepted an invite whose role was deleted",
      r.role_deleted_after_join && "a role was deleted in their church after they joined",
    ]
      .filter(Boolean)
      .join("; ");

  const print = (label: string, list: Candidate[]) => {
    console.log(`\n${label}: ${list.length}`);
    let church = "";
    for (const r of list) {
      if (r.church_id !== church) {
        church = r.church_id;
        console.log(`  ${r.church_name ?? "(unnamed)"} [${r.church_id}]`);
      }
      console.log(`    ${r.email ?? r.user_id} · staff ${r.staff_id} · ${why(r)}`);
    }
  };

  console.log(
    `admin-with-no-role seats: ${rows.length} (${legacy} with no evidence of ever holding a role — left alone as legacy admins)`,
  );
  print("Strong evidence (demoted by --apply)", strong);
  print(
    `Weak evidence (${INCLUDE_WEAK ? "demoted by --apply --include-weak" : "review by hand; add --include-weak to demote"})`,
    weak,
  );
  console.log(`\nPending invitations that would arrive as admin-with-no-role: ${invites.length}`);
  for (const i of invites) console.log(`  ${i.email} · church ${i.church_id} · invitation ${i.id}`);

  if (!APPLY) {
    console.log("\nDry run — nothing changed. Re-run with --apply to repair.");
    await pool.end();
    return;
  }

  const targets = INCLUDE_WEAK ? [...strong, ...weak] : strong;
  const client = await pool.connect();
  try {
    await client.query("begin");
    /*
     * The same predicate again in the UPDATE, so a row that changed since the
     * report (an owner assigned a role meanwhile) is not touched.
     */
    const { rows: demoted } = await client.query<{ id: string; organization_id: string }>(
      `update staff
          set role = 'member'
        where id = any($1::text[])
          and role = 'admin'
          and role_id is null
          and temp = false
      returning id, organization_id`,
      [targets.map((t) => t.staff_id)],
    );
    for (const d of demoted) {
      await client.query(
        `insert into audit_log
           (scope, church_id, actor_name, actor_role, action, module, severity,
            summary, target_type, target_id, meta)
         values
           ('church', $1, 'FlockInsight repair', 'system', 'team.member.revoke', 'team',
            'critical',
            'Removed full access left behind by a deleted or cleared role — now on the basics until given a role',
            'staff', $2, $3::jsonb)`,
        [d.organization_id, d.id, JSON.stringify({ repair: "deleted-role-admins" })],
      );
    }
    const { rowCount: invitesFixed } = await client.query(
      `update invitation i
          set role = 'member'
         from staff_invite si
        where si.invitation_id = i.id
          and i.status = 'pending'
          and i.role = 'admin'
          and si.role_id is null`,
    );
    await client.query("commit");
    console.log(
      `\nDemoted ${demoted.length} of ${targets.length} seat(s); ${invitesFixed ?? 0} pending invitation(s) dropped to member.`,
    );
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
