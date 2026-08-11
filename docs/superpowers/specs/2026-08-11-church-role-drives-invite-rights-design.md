# Church Role Drives Invite Rights — Design

**Date:** 2026-08-11
**Status:** Approved for planning
**Scope:** `assignRole` action, Team settings UI, one-off backfill

---

## 1. Problem

Assigning someone the church "Admin" role does not let them invite anyone.

The seeded **Admin** role is created with `ALL_PERMISSIONS`
(`permissions.ts` → `ensureDefaultRoles`), which includes `team.manage`. So:

1. A church assigns someone the Admin role → they hold `team.manage`.
2. `/settings/team` opens for them, because the page is gated on
   `requireCan("team.manage")`.
3. They press Invite → **Better Auth rejects it**, because the organization
   plugin checks `staff.role`, which is still `"member"`.

The role promises team management, the page admits them, and the button fails.

The cause is in `assignRole` (`src/app/(app)/settings/roles/actions.ts:154`),
which deliberately writes only `roleId`:

```ts
// Only set roleId — leave the Better Auth org role (owner/admin/member)
// untouched so org membership semantics and owner detection stay correct.
```

That comment protects a real concern — never accidentally writing `"owner"` —
but it also means the two role systems can never agree.

Related: invitations already derive the org role at invite time
(`betterAuthRoleFor` in `src/lib/staff-access.ts`, added 2026-08-09), so the
behaviour is currently inconsistent between inviting and reassigning.

## 2. Goals

- Assigning a role that includes "Manage team" lets that person invite and
  remove staff.
- Staff already broken by this today are fixed on deploy, not just future
  assignments.
- No second admin/member control to keep in sync.

## 3. Non-goals

- Changing what `staff.role = "owner"` means, or how the owner is detected.
- Changing the legacy fallback where an admin with **no** church role gets full
  access (`permissions.ts:70`). Churches predating roles rely on it.
- A manual per-person admin/member override.

## 4. Decision

**The church role is the single source of truth for org role.** `assignRole`
derives `staff.role` from the assigned role's permissions using the existing
`betterAuthRoleFor(permissions)`.

Rejected: a separate Admin/Member dropdown per team row. It is a second
overlapping concept beside the role select, and the two drifting apart is
exactly the defect being fixed.

## 5. Behaviour

`assignRole(staffId, roleId)`:

| Case | `staff.roleId` | `staff.role` |
|---|---|---|
| Role includes `team.manage` | set | `"admin"` |
| Role without `team.manage` | set | `"member"` |
| `roleId = null` (role cleared) | set to null | **unchanged** |
| Target is the owner | refused (existing guard) | — |

**Clearing a role leaves `staff.role` alone** on purpose. Writing `"member"`
there would silently demote a legacy admin who has no church role and depends
on the full-access fallback — a permissions regression disguised as a cleanup.

`"owner"` is never written. The only values this action can set are `"admin"`
and `"member"`.

## 6. New guard: self-lockout

`assignRole` currently has no self-check. Once it also writes `staff.role`,
assigning yourself a role without `team.manage` would drop you to `"member"`
and remove your ability to reach team management at all — recoverable only by
the church owner.

Refuse it:

> "You can't remove your own team management access — ask the church owner to
> change your role."

Triggered only when the target staff row belongs to the caller **and** the new
role lacks `team.manage`. Assigning yourself a role that keeps `team.manage` is
still allowed, and anyone with `team.manage` may still change *other* people
freely.

The owner is unaffected either way: the existing guard already refuses the
owner as a target, so an owner can never be demoted by this action — by
themselves or anyone else.

A superadmin acting as a church is also unaffected: their access comes from the
act-as override in `getAccess`, not from `staff.role`, so they cannot lock
themselves out.

## 7. Backfill

Existing staff with a `team.manage` role and `staff.role = 'member'` are broken
right now. A one-off script reconciles them:

```
scripts/backfill-org-roles.ts
```

- Selects staff joined to their role where the role's permissions contain
  `team.manage` and `staff.role = 'member'`, excluding `role = 'owner'`.
- Sets those to `"admin"`.
- **Only ever promotes.** It never demotes a `"member"`-permission holder from
  admin, because an existing admin may be relying on the legacy no-role
  fallback for access.
- Prints what it changed, and is safe to run more than once.

Run once after deploy.

## 8. UI

One line under the role select on the Team page:

> "Roles that include Manage team can also invite and remove people."

Makes the connection visible instead of implied. No new controls.

## 9. Error handling

Guards return `{ ok: false, error }` in the existing `ActionResult` shape, with
messages an administrator can act on. The self-lockout guard names the remedy
(ask the owner) rather than only stating the refusal.

## 10. Testing

- **Unit (Vitest):** `betterAuthRoleFor` already covers the derivation. Add
  cases asserting `ALL_PERMISSIONS` yields `"admin"` and
  `MEMBER_DEFAULT_PERMISSIONS` yields `"member"`, since those are the two
  seeded roles this feature turns on.
- **Live DB check** (extend `scripts/check-member-access.ts` or a sibling):
  assigning a `team.manage` role sets `staff.role = 'admin'`; assigning a role
  without it sets `'member'`; clearing a role leaves `staff.role` untouched;
  the owner's row is never modified.

## 11. Rollout

1. Ship the `assignRole` change and the UI line.
2. Run `scripts/backfill-org-roles.ts` once on the server.
3. No migration, no environment changes, no cron changes.

## 12. Out of scope

Per-person admin/member override · changing owner semantics · removing the
legacy full-access fallback for role-less admins · bulk role changes.
