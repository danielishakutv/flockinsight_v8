# Per-Recipient Delivery Reports — Design

**Date:** 2026-08-13
**Status:** Approved for planning
**Scope:** `lib/sms.ts`, `lib/mailer.ts`, communication send actions, two new webhook routes, communication history UI

---

## 1. Problem

The communication history records who a message was *attempted* to, but never
learns what happened next. Every recipient is frozen at `sent`, so a church
cannot tell an SMS that reached someone from one silently blocked by DND.

The schema already anticipated this. `communication_recipient` carries a
`providerMessageId` column commented *"Gateway's id for this message, for
reconciling delivery reports later"*, and `delivery_status` already includes
`delivered` and `undelivered`. Neither is ever used.

The reason is upstream:

- `lib/sms.ts` parses Termii's `message_id` / `message_id_list` **only to decide
  whether the send succeeded** (`sms.ts:98`), then returns `{ ok: true }`.
- `lib/mailer.ts` does `const { error } = await resend.emails.send(...)`
  (`mailer.ts:82`), discarding `data.id`.
- The communication actions never pass `providerMessageId` to
  `recordRecipients`, so it is null on every row ever written.

## 2. Verified provider capabilities

**Termii** — webhook only. A URL configured in the Termii console receives
`POST` JSON containing `type`, `id`, `message_id`, `receiver`, `sender`,
`message`, `sent_at`, `cost`, `status`, `channel`. Statuses: `DELIVERED`,
`DND Active on Phone Number`, `Message Sent`, `Received`, `Message Failed`,
`Rejected`, `Expired`. **No documented endpoint polls a message's status by
id.**

**Resend** — both. Webhook events `email.sent`, `email.delivered`,
`email.bounced`, `email.delivery_delayed`, `email.failed`, `email.opened`,
`email.clicked`, `email.complained`, `email.suppressed`, `email.scheduled`;
and `GET /emails/{id}` returning `last_event`.

## 3. Historical sends cannot be backfilled

Stated plainly because it was the original hope: **messages already sent will
stay at `sent` forever.**

No `providerMessageId` was ever stored, so there is no reference to reconcile.
For SMS it is doubly impossible — Termii offers no polling endpoint even if the
ids existed. For email the ids are gone, so `GET /emails/{id}` has nothing to
query. Reporting begins the day this ships.

## 4. Goals

- Per-recipient delivery outcome for SMS and email, visible in the history.
- Surface DND blocking specifically — the common, actionable failure in Nigeria.
- Summary counters that never contradict the per-recipient detail.

## 5. Non-goals

- Open and click tracking (decided: delivery only — no tracking pixels or
  rewritten links in church email). Webhook accepts and ignores those events so
  adding them later is a UI change.
- Refunding wallet units for undelivered SMS (decided: show, don't refund).
- Backfilling history.
- Replacing either provider.

## 6. Capturing the provider id

**Decision: store Termii's `message_id_list` positionally against the `to`
array, match webhooks on `message_id` first and fall back to `receiver`.**

`sendChurchSms` groups identical message bodies and calls Termii's bulk
endpoint, which returns an array of ids. Whether that array's order matches the
`to` array is **undocumented** — this is an assumption, and it must be verified
against a real send before the feature is trusted.

The fallback is what makes the assumption safe: Termii's callback includes
`receiver`, the recipient's phone number. If a report's `message_id` matches no
row, it is matched instead to the most recent `sent` recipient row in the same
church with that destination. A wrong ordering assumption therefore degrades to
"attributed by phone number", not to wrong data.

Rejected alternatives:
- One API call per recipient — unambiguous but defeats the bulk endpoint; 500
  members would mean 500 calls.
- Phone-only matching with no ids — ambiguous whenever one number receives two
  messages close together.

### Signature changes

```ts
// lib/sms.ts — the ok branch gains ids, aligned index-for-index with the
// normalised recipient list (invalid numbers already filtered out).
type SmsResult =
  | { ok: true; ids: string[] }
  | { ok: false; error: string };
```

Safe to change: the type is already a discriminated union, all three call sites
narrow on `.ok`, and TypeScript enforces it.

**`sendEmail` keeps returning `boolean`.** It has 34 call sites, many of the
form `const ok = await sendEmail(...)` followed by `if (ok)`. Changing it to
return an object would make that condition **always true** — `{ ok: false }` is
truthy — and TypeScript would not flag it, because testing an object for
truthiness is legal. Every email failure in reminders, celebrations,
devotionals and exports would silently be recorded as a success.

Instead a separate function is added for the only callers that need the id:

```ts
// lib/mailer.ts
export async function sendEmailWithId(opts: SendEmailOptions):
  Promise<{ ok: boolean; id: string | null }>;
```

`sendEmail` becomes a thin wrapper over it returning just `ok`, so there is one
implementation and no duplicated logic. Only the three communication send
actions — the ones that call `recordRecipients` — use the new function. The
other 31 call sites are untouched.

### When the id list is short

If Termii returns fewer ids than recipients (or none), the extras are recorded
with `providerMessageId: null`. Those recipients simply rely on the
`receiver` fallback in §8 for attribution. A missing id degrades matching; it
never blocks the send or loses the recipient row.

## 7. Status mapping

Pure function in `src/lib/delivery-status.ts`, no imports, unit-tested:

```ts
mapTermiiStatus(raw: string): "sent" | "delivered" | "undelivered" | null
mapResendEvent(type: string): "sent" | "delivered" | "undelivered" | null
```

| Termii status | Ours |
|---|---|
| `DELIVERED` | `delivered` |
| `Message Sent`, `Received` | `sent` |
| `DND Active on Phone Number` | `undelivered` |
| `Rejected`, `Expired`, `Message Failed` | `undelivered` |
| anything unrecognised | `null` (ignored, logged) |

| Resend event | Ours |
|---|---|
| `email.delivered` | `delivered` |
| `email.bounced`, `email.failed`, `email.suppressed` | `undelivered` |
| `email.sent` | `sent` |
| `email.opened`, `email.clicked`, `email.complained`, `email.delivery_delayed`, `email.scheduled` | `null` (ignored) |

Matching is case-insensitive and trimmed; unknown values are ignored rather
than guessed, and logged so a new provider status is noticed.

**Never downgrade.** A `delivered` row is never moved back to `sent` by a
late-arriving `Message Sent` report. Reports can arrive out of order.

## 8. Webhook routes

### `/api/webhooks/termii`
Termii documents no signature, so the route is guarded by a secret in the URL
(`?key=…`), matching the existing cron convention. New env var
`TERMII_WEBHOOK_SECRET`. A forged callback would additionally need to guess a
provider-generated `message_id`.

### `/api/webhooks/resend`
Resend signs webhooks (Svix). The signature is verified against
`RESEND_WEBHOOK_SECRET`; unverified requests are rejected with 401.

**Both routes:**
- Always return 200 for anything they have accepted or deliberately ignored.
  A 500 makes the provider retry indefinitely.
- Are idempotent — the same report arriving twice produces the same end state.
- Never throw. Errors are logged and swallowed.
- Update `communication_recipient.status`, and `error` with the human-readable
  reason (e.g. "Blocked — number is on the DND list").

## 9. Keeping counters honest

`communication_log` stores frozen `sent` / `failed` / `skipped` totals, and
`tally()` counts `undelivered` as failed. Once a report flips a recipient from
`sent` to `undelivered`, those totals are stale and the summary contradicts the
detail directly beneath it.

Every webhook therefore recomputes the parent log's counters from its recipient
rows, in the same transaction as the status update:

- `sent` = recipients whose status is `sent` or `delivered`
- `failed` = `failed` or `undelivered`
- `skipped` = `skipped`

`recipients` = sent + failed + skipped continues to reconcile.

## 10. UI

**Per-recipient list** (existing view) shows real states: **Delivered**,
**Not delivered** with the reason, **Sent — awaiting report**, plus today's
skipped and failed.

**Each history row** gains a line: `12 delivered · 2 not delivered · 1 pending`,
and a DND count when non-zero, because that is the one a church can act on by
cleaning its list.

**Recipient filters** gain Delivered / Not delivered / Pending.

**CSV export** gains `status` and `reason` columns.

**Empty state**, for every message sent before this ships: *"Delivery reports
started on <date>. Messages sent earlier show as sent."* — so the absence is
explained rather than looking broken.

## 11. Error handling

A webhook for an unknown `message_id` with no phone-number match is logged and
acknowledged with 200 — it is not an error, it may belong to a message sent
outside FlockInsight on the same Termii account. Malformed JSON returns 400
without logging the body, which contains recipient phone numbers.

## 12. Testing

- **Unit (Vitest):** every Termii status and Resend event maps correctly;
  unknown values return null; matching is case-insensitive; `delivered` is
  never downgraded.
- **Live check** (`scripts/check-delivery-reports.ts`): posts real-shaped Termii
  and Resend payloads at the routes against a seeded log, asserting the
  recipient row updates, the log counters recompute, a replayed report is a
  no-op, and a bad secret is rejected. Cleans up after itself.
- **Manual, post-deploy:** send one real SMS to a known number and confirm the
  callback arrives and attributes correctly. This is the only way to verify the
  `message_id_list` ordering assumption in §6.

## 13. Rollout

1. Migration: none — `providerMessageId` and the enum states already exist.
2. Deploy, then set `TERMII_WEBHOOK_SECRET` and `RESEND_WEBHOOK_SECRET` in
   `.env` and restart.
3. Configure the callback URL in the Termii console and a webhook in the Resend
   dashboard.
4. Send one real SMS and confirm attribution before relying on the numbers.

## 14. Out of scope

Open/click tracking · wallet refunds · backfilling history · per-recipient retry
of failed sends · switching providers.
