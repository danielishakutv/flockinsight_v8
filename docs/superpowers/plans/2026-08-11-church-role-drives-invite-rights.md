# Church Role Drives Invite Rights — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make assigning a church role that includes "Manage team" actually let that person invite and remove staff, and repair the staff who are broken by this today.

**Architecture:** `assignRole` becomes the single place where both role systems are set: it writes `staff.roleId` as now, and additionally derives `staff.role` ("admin" | "member") from the assigned role's permissions using the existing pure `betterAuthRoleFor()`. A one-off script promotes existing staff who already hold a `team.manage` role but are stuck at `staff.role = 'member'`.

**Tech Stack:** Next.js 16.2.7 (App Router) · TypeScript · Drizzle ORM · PostgreSQL 17 · Better Auth 1.6 organization plugin · Vitest

## Global Constraints

- **Never write `"owner"` to `staff.role`.** This action may only ever set `"admin"` or `"member"`. Owner detection (`staff.role === "owner"`, `permissions.ts:54`) must keep working.
- **The owner is never a valid target.** `assignRole` already refuses when the target row's `role === "owner"` (`roles/actions.ts:138-139`) — keep that guard first.
- **Clearing a role (`roleId = null`) must NOT touch `staff.role`.** Writing `"member"` there would silently demote a legacy admin who relies on the no-role full-access fallback at `permissions.ts:70`.
- **The backfill only ever promotes**, never demotes, for the same reason.
- Guard server actions with `can(...)` and a returned error, never `requireCan` (it redirects). Follow the existing `guard()` at `roles/actions.ts:26-32`.
- Never delete data. The backfill is an `UPDATE` only.
- Verify with `pnpm exec eslint <paths>` — bare `pnpm lint` scans `node_modules` (pre-existing `globalIgnores` override in `eslint.config.mjs`).
- Do not commit `Personal_Note`.

---

## File Structure

**Modify:**
- `src/app/(app)/settings/roles/actions.ts` — `assignRole` derives `staff.role`; new self-lockout guard
- `src/lib/staff-access.test.ts` — add the two seeded-role cases
- `src/components/settings/team-manager.tsx` — one explanatory line under the role select

**Create:**
- `scripts/backfill-org-roles.ts` — one-off reconciliation for existing staff

---

## Task 1: Cover the seeded roles in the unit tests

**Files:**
- Modify: `src/lib/staff-access.test.ts`

**Interfaces:**
- Consumes: `betterAuthRoleFor(permissions: string[]): "admin" | "member"` from `@/lib/staff-access`; `ALL_PERMISSIONS` and `MEMBER_DEFAULT_PERMISSIONS` from `@/lib/permissions-catalog`.

These two constants are what `ensureDefaultRoles` seeds every church's "Admin" and "Member" roles with, so they are the exact inputs this feature turns on. Import from `permissions-catalog` (client-safe), **not** `permissions` (which is `server-only` and would break the test run).

- [ ] **Step 1: Add the failing cases**

```ts
import {
  ALL_PERMISSIONS,
  MEMBER_DEFAULT_PERMISSIONS,
} from "@/lib/permissions-catalog";

describe("betterAuthRoleFor with the seeded church roles", () => {
  it("makes the seeded Admin role an org admin", () => {
    expect(betterAuthRoleFor(ALL_PERMISSIONS)).toBe("admin");
  });

  it("leaves the seeded Member role an org member", () => {
    expect(betterAuthRoleFor(MEMBER_DEFAULT_PERMISSIONS)).toBe("member");
  });
});
```

- [ ] **Step 2: Run.** `pnpm test`

These should **pass immediately** — `betterAuthRoleFor` already exists and is correct. That is the point: they pin the behaviour the rest of this plan depends on, and they fail loudly if someone later removes `team.manage` from `ALL_PERMISSIONS`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/staff-access.test.ts
git commit -m "Pin org-role derivation for the two seeded church roles"
```

---

## Task 2: `assignRole` sets both roles

**Files:**
- Modify: `src/app/(app)/settings/roles/actions.ts` (the `assignRole` function, currently lines 125-161)

**Interfaces:**
- Consumes: `betterAuthRoleFor` from `@/lib/staff-access`.
- Produces: `assignRole(staffId: string, roleId: string | null): Promise<ActionResult>` — unchanged signature.

- [ ] **Step 1: Import the helper**

```ts
import { betterAuthRoleFor } from "@/lib/staff-access";
```

- [ ] **Step 2: Load the target's user id alongside the existing select**

The current select reads `{ id, role }`. Add `userId` so the self-lockout guard can compare against the caller:

```ts
const [target] = await db
  .select({ id: staff.id, role: staff.role, userId: staff.userId })
  .from(staff)
  .where(and(eq(staff.id, staffId), eq(staff.organizationId, ctx.church.id)))
  .limit(1);
if (!target) return { ok: false, error: "Team member not found." };
if (target.role === "owner")
  return { ok: false, error: "The owner's access can't be changed." };
```

Keep the owner guard **before** everything else, so the owner can never be demoted.

- [ ] **Step 3: Capture the assigned role's permissions**

The existing block already loads the role to validate it. Extend that same query to return `permissions`, so no second round trip is needed:

```ts
let permissions: string[] | null = null;
if (roleId) {
  const [r] = await db
    .select({ isSystem: role.isSystem, permissions: role.permissions })
    .from(role)
    .where(and(eq(role.id, roleId), eq(role.churchId, ctx.church.id)))
    .limit(1);
  if (!r) return { ok: false, error: "Role not found." };
  if (r.isSystem)
    return { ok: false, error: "The Owner role can't be assigned." };
  permissions = r.permissions ?? [];
}
```

- [ ] **Step 4: Add the self-lockout guard**

```ts
// Writing staff.role means someone could now demote themselves out of team
// management entirely, recoverable only by the owner. Refuse that one case.
if (
  permissions !== null &&
  target.userId === ctx.user.id &&
  betterAuthRoleFor(permissions) !== "admin"
) {
  return {
    ok: false,
    error:
      "You can't remove your own team management access — ask the church owner to change your role.",
  };
}
```

- [ ] **Step 5: Write both columns**

```ts
// Clearing a role leaves staff.role alone: writing "member" would silently
// demote a legacy admin who has no church role and depends on the full-access
// fallback in lib/permissions.ts.
await db
  .update(staff)
  .set(
    permissions === null
      ? { roleId: null }
      : { roleId, role: betterAuthRoleFor(permissions) },
  )
  .where(and(eq(staff.id, staffId), eq(staff.organizationId, ctx.church.id)));

revalidatePath("/settings/team");
return { ok: true };
```

- [ ] **Step 6: Verify.** Run `pnpm exec tsc --noEmit` and `pnpm test`.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/settings/roles/actions.ts"
git commit -m "Assigning a role that can manage the team now grants invite rights"
```

---

## Task 3: Backfill the staff who are broken today

**Files:**
- Create: `scripts/backfill-org-roles.ts`

- [ ] **Step 1: Write the script**

It must be safe to run repeatedly and must only promote:

```ts
import "dotenv/config";
import { Pool } from "pg";

/**
 * One-off: promote staff who already hold a role granting team.manage but are
 * stuck at staff.role = 'member', so Better Auth rejects their invites.
 *
 * Only ever promotes. An existing admin is never demoted — they may have no
 * church role at all and be relying on the full-access fallback.
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
    returning s.id, s.organization_id, s.user_id
  `);

  console.log(`Promoted ${rows.length} staff member(s) to org admin.`);
  for (const r of rows) {
    console.log(`  church ${r.organization_id} · user ${r.user_id}`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
```

- [ ] **Step 2: Run it locally**

Run: `pnpm exec tsx scripts/backfill-org-roles.ts`
Expected: a count, and no error. Run it a second time — the second run must report `0`, proving it is idempotent.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-org-roles.ts
git commit -m "Backfill org role for staff already holding a team.manage role"
```

---

## Task 4: Make the connection visible on the Team page

**Files:**
- Modify: `src/components/settings/team-manager.tsx`

- [ ] **Step 1: Add one explanatory line**

Under the per-member role select in the team list, add:

```tsx
<p className="text-muted-foreground mt-1 text-xs">
  Roles that include “Manage team” can also invite and remove people.
</p>
```

Place it once beneath the members list rather than repeating it on every row, so the list stays scannable.

- [ ] **Step 2: Verify.** Run `pnpm exec tsc --noEmit` and `pnpm exec eslint src/components/settings`.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/team-manager.tsx
git commit -m "Say on the Team page which roles can invite"
```

---

## Task 5: Verify end-to-end and ship

- [ ] **Step 1: Static gates.** Run each, quoting real output:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm exec eslint "src/app/(app)/settings" src/components/settings src/lib scripts
pnpm build
```

- [ ] **Step 2: Live DB check.** Write and run a throwaway check (or extend `scripts/check-member-access.ts`) proving, against the real database:

1. Assigning a role whose permissions contain `team.manage` sets `staff.role = 'admin'`.
2. Assigning a role without it sets `staff.role = 'member'`.
3. Passing `roleId = null` leaves `staff.role` unchanged.
4. A row with `role = 'owner'` is never modified.

Clean up any rows the check creates.

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Report the deploy commands**

```bash
cd /home/flockinsight/app && git pull && pnpm install --prod=false && \
  mv .next .next.bak.$(date +%F-%H%M) 2>/dev/null; pnpm build && pm2 restart flockinsight
```

Then, once, to repair existing churches:

```bash
cd /home/flockinsight/app && pnpm exec tsx scripts/backfill-org-roles.ts
```

**No migration this time** — no schema change.

---

## Self-Review Notes

**Spec coverage:** §4 decision → Task 2. §5 behaviour table → Task 2 steps 3 and 5 (including the `roleId = null` rule). §6 self-lockout guard → Task 2 step 4. §7 backfill → Task 3. §8 UI → Task 4. §9 error handling → Task 2 (all guards return `ActionResult`). §10 testing → Task 1 (unit) and Task 5 step 2 (live). §11 rollout → Task 5 steps 3–4.

**Placeholder scan:** none — every step carries the code or the exact command.

**Type consistency:** `betterAuthRoleFor(permissions: string[]): "admin" | "member"` is used identically in Task 1 and Task 2. `assignRole`'s signature is unchanged, so `team-manager.tsx:138` keeps compiling untouched. `ActionResult` is the file's existing type.

**Ordering constraint:** Task 3's backfill is independent of Task 2 and can run before or after deploy, but running it *after* the Task 2 deploy means new assignments are already correct and the script only has historic rows to fix.
