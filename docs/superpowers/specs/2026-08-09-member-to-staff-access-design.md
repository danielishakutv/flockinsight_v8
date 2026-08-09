# Giving an Existing Member App Access — Design

**Date:** 2026-08-09
**Status:** Approved for planning
**Scope:** Member profile, Settings → Team, members bulk bar, accept-invitation flow

---

## 1. Problem

A church admin looking at a member's profile has no way to give that person a
login and a role. Access is granted only from Settings → Team, and the flow
there is incomplete.

What exists today:

- `member.userId` links a congregation member to a login account.
- The member profile shows a **read-only** "Team member" badge
  (`member-profile.tsx:124`).
- Settings → Team lists members with an email and no linked login
  (`settings/team/page.tsx:56-79`), but selecting one **only autofills the email
  box** (`team-manager.tsx:142-145`).
- Invites go out through the client-side `organization.inviteMember`.

Four concrete gaps:

1. **The church role cannot be chosen at invite time.** The invitation carries
   only Better Auth's `member`/`admin`. The real role (`staff.roleId`) must be
   assigned afterwards from the Team page; until then the person is in with
   fallback permissions.
2. **The invitation does not record which member it is for.** The link back is
   re-derived at accept time by email matching in `ensureMemberForUser`.
3. **`team.manage` does not actually work for non-admins.** The Team *page* is
   gated by `requireCan("team.manage")`, but `organization.inviteMember` runs
   client-side and Better Auth enforces its own org role. A custom role granting
   "Manage team" opens the page and then fails on invite.
4. **No way to revoke access**, and no way to see access state, from the member
   side.

## 2. Goals

- Give an existing member a login and a church role in one step, from their
  profile.
- Never create a duplicate person record.
- Revoke app access without deleting the member or their history.
- Make `team.manage` genuinely grant the ability to invite.

## 3. Non-goals

- Redesigning roles or permissions.
- Inviting by SMS (they still need an email to create a login).
- Self-service access requests from members.
- Changing how the invitation email itself is composed or sent.

## 4. Architecture decision

**Carry the member and role in a `staff_invite` side table, not on
`invitation`.** Better Auth owns the `invitation` table; a missing `createdAt`
column on it already caused 500s in this project (see
`flockinsight-project` notes). Adding our own columns to a plugin-managed table
risks the same class of breakage on the next upgrade. A side table keyed by
`invitationId` keeps a clean boundary and cascades away with the invitation.

Rejected: resolving member and role at accept time by email alone — it cannot
carry the chosen role, which is the point of the feature.

## 5. Data model

```
staff_invite
  id uuid pk
  invitation_id text notnull unique  -> invitation.id  on delete cascade
  member_id     uuid notnull         -> member.id      on delete cascade
  role_id       uuid                 -> role.id        on delete set null
  created_at    timestamptz notnull default now()
  index (member_id)
```

`role_id` is nullable: a role deleted between invite and acceptance must not
block the person from joining — they join with no church role, exactly as a
plain email invite does today.

## 6. Role derivation

New pure helper in `src/lib/staff-access.ts`:

```ts
betterAuthRoleFor(permissions: string[]): "admin" | "member"
```

Returns `"admin"` when the permission list contains `team.manage`, else
`"member"`. This is the fix for gap 3: a church role that grants "Manage team"
now also grants the Better Auth org role that makes it work. Pure, no imports,
unit-tested.

The invite dialog exposes **one** select — the church role. The Better Auth role
is derived, never shown, so the two concepts cannot drift out of sync.

## 7. Server actions

All live in `src/app/(app)/members/access-actions.ts` and authorise with
`requireCan("team.manage")` **server-side**, then create the invitation through
`auth.api.createInvitation` with the request headers. This moves authorisation
off the client and closes gap 3.

### `inviteMemberAsStaff({ memberId, roleId, email? })`

Order of operations:

1. `requireCan("team.manage")`.
2. Load the member, scoped to the caller's church. Not found → error.
3. Already has `userId` → `{ ok: false, error: "This member already has app access." }`.
4. Resolve the email: the member's own, or `email` when they have none. Missing
   or malformed → error naming the problem. When `email` is supplied and the
   member had none, **save it to the member record** (approved: it fixes the
   missing datum permanently).
5. Email already belongs to a staff account in this church → error.
6. A pending invitation for this email already exists → reuse it rather than
   creating a duplicate invitation. Because `staff_invite.invitation_id` is
   unique, the side row is **upserted** (`onConflictDoUpdate` on
   `invitation_id`, refreshing `member_id` and `role_id`) — so re-inviting the
   same person with a different role updates the pending invite instead of
   failing on the unique index.
7. Validate `roleId` belongs to this church and is not the locked system Owner
   role (same guard as `assignRole`).
8. Create the invitation via `auth.api.createInvitation` with the derived Better
   Auth role. The existing `sendInvitationEmail` hook fires unchanged.
9. Insert the `staff_invite` row.

Returns `{ ok: true, invitationId }` so the UI can offer "Copy link" for a
member whose email may not reach them.

### `revokeMemberAccess(memberId)`

1. `requireCan("team.manage")`.
2. Load the member scoped to the caller's church. No `userId` →
   `{ ok: false, error: "This member doesn't have app access." }`.
3. Refuse when the target staff row is `role === "owner"` — the owner's access
   cannot be removed.
4. Refuse when the target user is the caller — no locking yourself out.
5. Delete the `staff` row for that user in this church; set `member.userId` to
   null. Also cancel any pending invitation for that member, so a stale link
   cannot re-grant the access just revoked.

The member row, their attendance, giving and every other record are untouched.
This removes a login, not a person. The `user` account itself is also kept — it
may belong to other churches.

### `inviteMembersAsStaff({ memberIds, roleId })`

Loops the single action and returns
`{ invited: number; skipped: { memberId, name, reason }[] }`. Reasons are the
plain-language errors above, so the UI can say exactly who was skipped and why.

## 8. Accept-time behaviour

`joinChurch` in `src/app/accept-invitation/actions.ts:55` is the single point
where a `staff` row is created. It gains one lookup:

- Read `staff_invite` by `invitation_id`.
- When present: create the staff row **with `roleId` already set**, and set
  `member.userId` on that exact member id.
- When absent: today's behaviour unchanged — `ensureMemberForUser` matches by
  email or creates a profile.

The member link is by id, not by email, so renaming or re-typing an email
between invite and acceptance cannot mis-link two people.

Edge case: if the linked member row was deleted before acceptance, fall back to
`ensureMemberForUser`. Joining must never fail because of a missing side row.

## 9. UI

### Member profile (`member-profile.tsx`)
The read-only badge becomes an access section:

- **Has access:** shows their church role and a Revoke button (confirm dialog
  stating that the member and their history are kept).
- **Pending invite:** shows "Invitation sent to <email>" with Copy link and
  Cancel.
- **No access:** a "Give app access" button, shown only when the viewer has
  `team.manage`.

### Invite dialog (`components/members/give-access-dialog.tsx`)
Member's name; their email, or an email field when they have none, labelled to
say it will be saved to their profile; a role select; and a line describing what
the selected role can do, read from the existing permission catalog. Primary
button states the outcome — "Send invitation" — not a generic verb.

### Settings → Team
The existing dropdown stops merely autofilling the email. It carries the chosen
member and role into `inviteMemberAsStaff`, so inviting an existing member from
here behaves identically to inviting from their profile.

### Members list bulk bar (`members-list.tsx:262`)
The bar already exists for delete and export. It gains "Give app access":
one role for the whole selection, then a summary toast — invited count plus the
skipped list with reasons.

## 10. Error handling

Every guard returns `{ ok: false, error }` with a sentence a church
administrator can act on ("This member has no email address — add one to invite
them."), never a raw exception. The bulk action never aborts partway: one
member's failure is recorded as a skip and the rest continue.

## 11. Testing

- **Unit (Vitest):** `betterAuthRoleFor` — grants admin only for `team.manage`,
  member otherwise, and for an empty list.
- **Integration, exercised live against the dev server:** invite a member with
  an email; invite one without (email captured and persisted); accept and
  confirm the staff row carries the right `roleId` and `member.userId`; revoke
  and confirm the member and their giving/attendance rows survive; confirm the
  owner and self cannot be revoked.

## 12. Rollout

1. Migration for `staff_invite`.
2. `staff-access.ts` + tests, then the actions, then the accept hook, then UI.
3. No environment changes. No cron changes. Existing pending invitations keep
   working — they simply have no side row and take the fallback path.

## 13. Out of scope

Bulk role *changes* for existing staff · inviting non-members by email (already
works) · SMS invitations · member self-service access requests.
