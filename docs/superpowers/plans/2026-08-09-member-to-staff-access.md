# Member-to-Staff Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin give an existing congregation member a login and a church role in one step, from the member's profile, the Team page, or the members bulk bar — and revoke it without deleting the person.

**Architecture:** A `staff_invite` side table keyed by `invitation_id` carries the member and chosen role from invite to acceptance, leaving Better Auth's `invitation` table untouched. Invitation creation moves server-side (`auth.api.createInvitation`) so authorisation runs against our own `team.manage` permission. `joinChurch` applies the role and links the exact member on acceptance.

**Tech Stack:** Next.js 16.2.7 (App Router) · TypeScript · Drizzle ORM · PostgreSQL 17 · Better Auth 1.6 organization plugin · shadcn/ui · Vitest

## Global Constraints

- **Guard server actions with `can("team.manage")`, never `requireCan`.** `requireCan` calls `redirect()` (`src/lib/permissions.ts:92`), which throws inside a server action instead of returning a usable error. Follow the existing `guard()` pattern in `src/app/(app)/settings/roles/actions.ts:26-32`.
- **Never delete a member, a user account, or any history when revoking access.** Revoke removes the `staff` row and clears `member.userId` only. (Global user rule: never delete data.)
- **`assignRole` sets ONLY `staff.roleId`** — never `staff.role` — to avoid privilege escalation to "owner". The new code follows the same rule except where the spec explicitly derives the Better Auth role at *invite* time.
- **The locked system Owner role can never be assigned** (`role.isSystem === true`), matching the guard in `assignRole`.
- Drizzle uses `casing: "snake_case"` — TS `invitationId` maps to SQL `invitation_id`.
- Money/`sum()` note does not apply here; no numeric aggregates in this feature.
- Never remove `serverExternalPackages` in `next.config.ts` or the `pnpm.overrides.kysely: 0.28.17` pin.
- Do not commit `Personal_Note`.
- Verify with `pnpm exec eslint src scripts` — bare `pnpm lint` scans `node_modules` due to a pre-existing `globalIgnores` override in `eslint.config.mjs`.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `src/lib/staff-access.ts` | Pure: `betterAuthRoleFor(permissions)`. No DB imports. |
| `src/lib/staff-access.test.ts` | Unit tests for the above. |
| `src/app/(app)/members/access-actions.ts` | `inviteMemberAsStaff`, `inviteMembersAsStaff`, `revokeMemberAccess`. |
| `src/components/members/give-access-dialog.tsx` | The invite dialog (client). |
| `src/components/members/member-access-card.tsx` | Access state + actions on the member profile (client). |

**Modify:**
- `src/db/schema.ts` — add `staffInvite` table + inferred type
- `src/app/accept-invitation/actions.ts:55-88` — apply role + link member in `joinChurch`
- `src/app/(app)/members/[id]/page.tsx` — pass access data to the profile
- `src/components/members/member-profile.tsx:124-128` — replace the static badge
- `src/components/members/members-list.tsx:262` — add bulk "Give app access"
- `src/components/settings/team-manager.tsx:141-157` — dropdown uses the new action
- `src/app/(app)/settings/team/page.tsx` — pass roles to the dropdown

---

## Task 1: Pure role derivation

**Files:**
- Create: `src/lib/staff-access.ts`, `src/lib/staff-access.test.ts`

**Interfaces:**
- Produces: `betterAuthRoleFor(permissions: string[]): "admin" | "member"`; `TEAM_MANAGE_PERMISSION = "team.manage"`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { betterAuthRoleFor } from "@/lib/staff-access";

describe("betterAuthRoleFor", () => {
  it("grants admin when the role can manage the team", () => {
    expect(betterAuthRoleFor(["members.view", "team.manage"])).toBe("admin");
  });

  it("is a plain member without team.manage", () => {
    expect(betterAuthRoleFor(["members.view", "giving.manage"])).toBe("member");
  });

  it("is a plain member for an empty permission list", () => {
    expect(betterAuthRoleFor([])).toBe("member");
  });

  it("does not match a permission that merely starts with team.", () => {
    expect(betterAuthRoleFor(["team.view"])).toBe("member");
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm test` — Expected: FAIL, cannot resolve `@/lib/staff-access`.

- [ ] **Step 3: Implement**

```ts
/**
 * Which Better Auth org role a church role needs.
 *
 * Better Auth gates invite/remove on its own org role, so a church role that
 * grants "Manage team" must also carry `admin` or the permission silently does
 * nothing. Pure so it can be unit-tested and reused on the client.
 */
export const TEAM_MANAGE_PERMISSION = "team.manage";

export function betterAuthRoleFor(permissions: string[]): "admin" | "member" {
  return permissions.includes(TEAM_MANAGE_PERMISSION) ? "admin" : "member";
}
```

- [ ] **Step 4: Run and verify it passes.** Run: `pnpm test` — Expected: 4 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/staff-access.ts src/lib/staff-access.test.ts
git commit -m "Derive the Better Auth org role from a church role's permissions"
```

---

## Task 2: `staff_invite` table

**Files:**
- Modify: `src/db/schema.ts` (append before the "Type helpers" block)
- Create: migration via `pnpm db:generate`

**Interfaces:**
- Produces: `staffInvite` Drizzle table; `export type StaffInvite = typeof staffInvite.$inferSelect;`

- [ ] **Step 1: Add the table**

```ts
/**
 * Links a Better Auth invitation to the congregation member it was sent for and
 * the church role they should get on acceptance.
 *
 * Kept out of the `invitation` table on purpose: Better Auth owns that schema,
 * and a missing column on it has already broken this app once. `roleId` is
 * nullable so deleting a role between invite and acceptance cannot block
 * someone from joining.
 */
export const staffInvite = pgTable(
  "staff_invite",
  {
    id: uuid().primaryKey().defaultRandom(),
    invitationId: text()
      .notNull()
      .unique()
      .references(() => invitation.id, { onDelete: "cascade" }),
    memberId: uuid()
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    roleId: uuid().references(() => role.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("staff_invite_member_idx").on(t.memberId)],
);
```

Add `export type StaffInvite = typeof staffInvite.$inferSelect;` beside the other type helpers.

**Check first:** confirm `member.id` is `uuid()` and `invitation.id` is `text()` in `src/db/schema.ts` before writing the column types — a mismatched FK type fails at migrate time.

- [ ] **Step 2: Generate the migration**

Run `pnpm db:generate`, then **read the generated SQL**. It must contain only `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE ... ADD CONSTRAINT`. If it contains any `DROP`, stop and investigate — do not apply it.

- [ ] **Step 3: Apply.** Run `pnpm db:migrate`.

- [ ] **Step 4: Verify the table exists**

```bash
pnpm exec tsx -e "require('dotenv/config');const{Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});p.query(\"select column_name,data_type from information_schema.columns where table_name='staff_invite' order by ordinal_position\").then(r=>{console.table(r.rows);return p.end()})"
```

Expected: 5 columns — `id`, `invitation_id`, `member_id`, `role_id`, `created_at`.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations
git commit -m "Add staff_invite to carry member and role through an invitation"
```

---

## Task 3: Invite and revoke server actions

**Files:**
- Create: `src/app/(app)/members/access-actions.ts`

**Interfaces:**
- Consumes: `betterAuthRoleFor` (Task 1), `staffInvite` (Task 2), `can` from `@/lib/permissions`, `requireChurch` from `@/lib/session`, `auth` from `@/lib/auth`.
- Produces:
  - `type AccessResult = { ok: true; invitationId: string } | { ok: false; error: string }`
  - `inviteMemberAsStaff(input: { memberId: string; roleId: string | null; email?: string }): Promise<AccessResult>`
  - `inviteMembersAsStaff(input: { memberIds: string[]; roleId: string | null }): Promise<{ ok: true; invited: number; skipped: { memberId: string; name: string; reason: string }[] } | { ok: false; error: string }>`
  - `revokeMemberAccess(memberId: string): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Write the guard and the invite action**

Guard follows `roles/actions.ts`:

```ts
async function guard() {
  const ctx = await requireChurch();
  if (!(await can("team.manage"))) {
    return { ctx, error: "You don't have permission to manage the team." as const };
  }
  return { ctx, error: null };
}
```

`inviteMemberAsStaff` performs, in this order (each failure returns a sentence an admin can act on):

1. `guard()`.
2. Load the member by id **scoped to `ctx.church.id`**. Missing → `"Member not found."`
3. `member.userId` already set → `"This member already has app access."`
4. Resolve the email: `member.email` if present, else the trimmed `input.email`. None → `"This member has no email address — add one to invite them."` Validate with `z.string().email()`; invalid → `"That doesn't look like a valid email address."`
5. When `input.email` was used because the member had none, `UPDATE member SET email = <that email>` (spec §7 step 4).
6. Reject when that email already belongs to a non-temp `staff` row in this church → `"Someone with that email is already on the team."`
7. When `roleId` is given: it must exist, belong to this church, and have `isSystem === false` → otherwise `"Role not found."` / `"The Owner role can't be assigned."` Load its `permissions` for step 8.
8. `const orgRole = betterAuthRoleFor(rolePermissions ?? [])`.
9. Find a pending `invitation` for that email in this church. If found, reuse its id. Otherwise create one:

```ts
const created = await auth.api.createInvitation({
  body: { email, role: orgRole, organizationId: ctx.church.id },
  headers: await headers(),
});
```

10. Upsert the side row — required, because `invitation_id` is unique and re-inviting reuses the invitation:

```ts
await db
  .insert(staffInvite)
  .values({ invitationId, memberId, roleId })
  .onConflictDoUpdate({
    target: staffInvite.invitationId,
    set: { memberId, roleId },
  });
```

11. `revalidatePath("/members")`, `revalidatePath(\`/members/${memberId}\`)`, `revalidatePath("/settings/team")`.
12. Return `{ ok: true, invitationId }`.

- [ ] **Step 2: Write the bulk action**

Validates `roleId` once, then loops `inviteMemberAsStaff` per member, collecting failures as skips rather than aborting:

```ts
const skipped: { memberId: string; name: string; reason: string }[] = [];
let invited = 0;
for (const id of input.memberIds) {
  const res = await inviteMemberAsStaff({ memberId: id, roleId: input.roleId });
  if (res.ok) invited++;
  else skipped.push({ memberId: id, name: nameOf(id), reason: res.error });
}
return { ok: true, invited, skipped };
```

- [ ] **Step 3: Write the revoke action**

1. `guard()`.
2. Load the member scoped to the church. No `userId` → `"This member doesn't have app access."`
3. Load the `staff` row for `(church, member.userId)`. `role === "owner"` → `"The church owner's access can't be removed."`
4. `member.userId === ctx.user.id` → `"You can't remove your own access."`
5. In one transaction: delete that `staff` row; `UPDATE member SET user_id = NULL`; set any pending `invitation` for that email in this church to `status = 'cancelled'` (spec §7 — otherwise the old emailed link re-grants what was just revoked).
6. Revalidate the same three paths.

**Note:** the `user` row is never touched — it may belong to other churches. Nothing else about the member is changed.

- [ ] **Step 4: Verify it compiles.** Run `pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/members/access-actions.ts"
git commit -m "Add server actions to grant and revoke member app access"
```

---

## Task 4: Apply role and link the member on acceptance

**Files:**
- Modify: `src/app/accept-invitation/actions.ts:55-88` (`joinChurch`)

**Interfaces:**
- Consumes: `staffInvite` (Task 2).

- [ ] **Step 1: Read the side row before creating staff**

```ts
const [side] = await db
  .select({ memberId: staffInvite.memberId, roleId: staffInvite.roleId })
  .from(staffInvite)
  .where(eq(staffInvite.invitationId, inv.id))
  .limit(1);
```

- [ ] **Step 2: Create the staff row with the role already set**

Change the existing insert to include `roleId: side?.roleId ?? null`. The person lands with the correct permissions immediately rather than on fallback access until someone remembers to assign a role.

- [ ] **Step 3: Link the exact member instead of guessing by email**

Replace `if (!wasMember) await ensureMemberForUser(...)` with:

```ts
if (!wasMember) {
  let linked = false;
  if (side?.memberId) {
    const res = await db
      .update(member)
      .set({ userId })
      .where(and(eq(member.id, side.memberId), eq(member.churchId, inv.organizationId), isNull(member.userId)))
      .returning({ id: member.id });
    linked = res.length > 0;
  }
  // No side row, or the member was deleted/already linked meanwhile — fall back
  // to matching by email. Joining must never fail over this.
  if (!linked) await ensureMemberForUser(inv.organizationId, userId);
}
```

Linking by id (not email) means editing an email between invite and acceptance cannot mis-link two people.

- [ ] **Step 4: Verify it compiles.** Run `pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/app/accept-invitation/actions.ts
git commit -m "Apply the invited role and link the exact member on acceptance"
```

---

## Task 5: Invite dialog

**Files:**
- Create: `src/components/members/give-access-dialog.tsx`

**Interfaces:**
- Consumes: `inviteMemberAsStaff` (Task 3).
- Produces: `<GiveAccessDialog open onOpenChange member={{ id, name, email }} roles={{ id, name, description }[]} onDone?={() => void} />`

- [ ] **Step 1: Build the dialog**

Contents:
- Member name as the dialog title context.
- Their email when present, read-only. When absent, an email `Input` (`type="email"`, required) with helper text: *"We'll save this to their profile and send the invitation there."*
- A role `Select` listing the passed roles, plus a "No role yet" option mapping to `roleId: null`.
- A line under the select describing what the chosen role can do, from the role's `description`.
- Primary button labelled **"Send invitation"** (states the outcome, not a generic verb).

On submit: call `inviteMemberAsStaff`, `toast.success("Invitation sent to <email>")` or `toast.error(res.error)`, then `router.refresh()` and close.

- [ ] **Step 2: Verify it compiles.** Run `pnpm exec tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add src/components/members/give-access-dialog.tsx
git commit -m "Add the give-access dialog"
```

---

## Task 6: Member profile access section

**Files:**
- Create: `src/components/members/member-access-card.tsx`
- Modify: `src/components/members/member-profile.tsx:124-128`, `src/app/(app)/members/[id]/page.tsx`

**Interfaces:**
- Consumes: `GiveAccessDialog` (Task 5), `revokeMemberAccess` (Task 3).
- Produces: `<MemberAccessCard member={{id,name,email}} access={MemberAccess} roles={Role[]} canManage />` where
  `type MemberAccess = { state: "none" } | { state: "active"; roleName: string | null } | { state: "invited"; email: string; invitationId: string }`

- [ ] **Step 1: Load access state in the page**

In `members/[id]/page.tsx`, alongside the existing member query, load: the `staff` row + its role name for `member.userId` (when set), and any pending `invitation` joined through `staff_invite` for this member. Derive the `MemberAccess` union above. Also load assignable roles (`isSystem === false`) for the dialog.

- [ ] **Step 2: Render the card**

- `state: "active"` → "Has app access", the role name (or "No role assigned"), and a **Revoke** button.
- `state: "invited"` → "Invitation sent to <email>", with **Copy link** (`/accept-invitation/<id>`) and **Cancel invitation**.
- `state: "none"` → a **Give app access** button opening the dialog.

Render the whole card only when `canManage` is true.

- [ ] **Step 3: Revoke confirmation**

A `Dialog` that states plainly: *"<Name> will no longer be able to sign in. Their member profile, attendance and giving records are all kept."* Confirm button: **"Remove access"**.

- [ ] **Step 4: Replace the static badge**

In `member-profile.tsx`, keep the "Team member" badge for at-a-glance scanning but drive it from the same access state; the card is where the actions live.

- [ ] **Step 5: Verify.** Run `pnpm exec tsc --noEmit` and `pnpm exec eslint src`.

- [ ] **Step 6: Commit**

```bash
git add src/components/members "src/app/(app)/members/[id]/page.tsx"
git commit -m "Show and manage app access from the member profile"
```

---

## Task 7: Team page and bulk bar

**Files:**
- Modify: `src/components/settings/team-manager.tsx:141-157`, `src/app/(app)/settings/team/page.tsx`, `src/components/members/members-list.tsx:262`

- [ ] **Step 1: Team page dropdown carries member + role**

Replace the `onValueChange` that only calls `setEmail(m.email)` with state holding the selected `memberId`. On submit, when a member is selected call `inviteMemberAsStaff({ memberId, roleId })`; otherwise keep today's plain email invite for non-members. Add a church-role select beside it, populated from the roles the page already loads (it currently passes `assignableRoles` for the per-member role selects — reuse that same list).

- [ ] **Step 2: Bulk action in the members list**

The selection bar at `members-list.tsx:262` already exists for delete and export. Add **"Give app access"**, opening a small dialog with one role select for the whole selection. On confirm call `inviteMembersAsStaff({ memberIds: [...selected], roleId })`.

Report the outcome honestly:

```ts
toast.success(`${res.invited} invitation${res.invited === 1 ? "" : "s"} sent`);
if (res.skipped.length > 0) {
  toast.warning(
    `${res.skipped.length} skipped: ${res.skipped
      .slice(0, 3)
      .map((s) => `${s.name} (${s.reason})`)
      .join("; ")}${res.skipped.length > 3 ? "…" : ""}`,
  );
}
```

- [ ] **Step 3: Verify.** Run `pnpm exec tsc --noEmit` and `pnpm exec eslint src`.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/team-manager.tsx "src/app/(app)/settings/team/page.tsx" src/components/members/members-list.tsx
git commit -m "Invite existing members with a role from Team and the members list"
```

---

## Task 8: Verify end-to-end and ship

- [ ] **Step 1: Static gates.** Run each and quote the real output; do not claim success for a step that did not run clean:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm exec eslint src scripts
pnpm build
```

- [ ] **Step 2: Live flow against the dev server.** Start `pnpm dev`, sign in as the demo owner, then confirm each:

1. A member **with** an email: profile shows "Give app access" → invite with a role → profile flips to "Invitation sent".
2. A member **without** an email: the dialog asks for one; after inviting, that email is saved on the member row (check the DB).
3. Accept the invitation: the new `staff` row has the chosen `role_id`, and `member.user_id` points at **that** member.
4. Revoke: the `staff` row is gone, `member.user_id` is null, the member row and their giving/attendance rows still exist, and any pending invitation is `cancelled`.
5. Owner and self cannot be revoked (both return the error, no rows change).

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Report the deploy command**

```bash
cd /home/flockinsight/app && git pull && pnpm install --prod=false && \
  mv .next .next.bak.$(date +%F-%H%M) 2>/dev/null; pnpm db:migrate && pnpm build && pm2 restart flockinsight
```

Note that `pnpm db:migrate` is required — this ships a new table.

---

## Self-Review Notes

**Spec coverage:** §5 data model → Task 2. §6 role derivation → Task 1. §7 invite/bulk/revoke actions → Task 3. §8 accept-time behaviour → Task 4. §9 UI: dialog → Task 5, member profile → Task 6, Team page + bulk bar → Task 7. §10 error handling → Task 3 (per-guard messages) and Task 7 (skip reporting). §11 testing → Task 1 (unit) and Task 8 (live). §12 rollout → Tasks 2 and 8.

**Ordering constraint:** Task 4 depends on Task 2's table existing; Tasks 5–7 depend on Task 3's action signatures.

**Type consistency:** `AccessResult` (Task 3) is consumed in Tasks 5–7. `MemberAccess` (Task 6) is produced by the page and consumed by the card. `betterAuthRoleFor` (Task 1) is called only in Task 3. `staffInvite` (Task 2) is read in Task 3 and Task 4.

**Deliberate deviation from the spec, for the reason given:** the spec §7 says actions "authorise with `requireCan("team.manage")`". `requireCan` redirects rather than returning, which is wrong inside a server action, so the plan uses `can("team.manage")` with a returned error — matching the existing `guard()` pattern. Same authorisation, correct failure mode.
