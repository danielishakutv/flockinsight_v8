# Email wallet-charging — proposal (HELD for your sign-off)

You asked to charge email from the wallet once a church exhausts its plan email
allowance ($1 per 100 emails). I **did not implement the charging** because,
done wrong, it can silently break critical flows. This doc is the safe design to
approve before we build it.

## Why it was held

Your email pipeline sends **transactional** mail, not just marketing:

- Member self-registration **OTP codes** (people can't update their record
  without these)
- Password resets & email verification (Better Auth)
- Service reminders, celebrations, first-timer welcome/invite
- Devotionals/newsletters, subscriber welcomes
- Communication broadcasts and event-guest messages (these are the "bulk" ones)

If a wallet/allowance check ever blocks a **transactional** send, you get
locked-out users and failed verifications with no obvious cause. So the golden
rule:

> **Never meter or block transactional email. Only ever charge for bulk /
> marketing email that the church chooses to send.**

## What already shipped (safe, no charging)

- Per-plan monthly email allowances in `src/lib/plans.ts`
  (`emailAllowance`: Starter 500, Growth 3,000, Pro 15,000, Enterprise ∞) +
  `emailAllowanceFor(planId)`.
- `churchUsageSince(churchId, day)` for this-month counts.
- The dashboard **Wallet & messaging** card shows emails-this-month vs allowance
  with a progress bar (and an "over allowance" note) — display only.

## Proposed charging model (to build once approved)

**Scope: charge only the Communication module and event-guest emails** (the
church-initiated bulk sends). Leave every transactional/automated email free and
unmetered, always.

1. **Price setting** — add a platform setting `email_price` (NGN per email).
   `$1 / 100 emails` ≈ ₦1,600 / 100 = **₦16 per email** (make it a configurable
   setting like `sms_price`, defaulting to ₦16, so you can tune it as FX moves).
   Note: the wallet is NGN (Paystack), so we bill NGN, not USD.

2. **Allowance-aware send** — in `sendCommunication` (email branch) and
   `messageEventGuests` (email branch) only:
   - Compute `usedThisMonth = churchUsageSince(churchId, monthStart).email`.
   - `remainingFree = max(0, emailAllowance - usedThisMonth)` (∞ if allowance is
     null → never charge).
   - For a send of N emails: `free = min(N, remainingFree)`,
     `billable = N - free`, `cost = billable * emailPrice`.
   - If `cost > walletBalance` → **block the bulk send** with a clear message
     ("This send needs ₦X but your balance is ₦Y — top up or reduce recipients")
     and offer a top-up link. (Blocking a *bulk marketing* send is fine; it's the
     church's choice.)
   - Else send, then debit the wallet `cost` in one transaction and write a
     `wallet_txn` with a new category `"email"` (add to `walletTxnCategoryEnum`
     — note: adding an enum value needs a careful migration; prefer storing the
     category as the existing `"sms"`→ generalise, or add `"email"` via a
     separate additive migration tested off-hours).

3. **Top-up path** — reuse the existing wallet top-up (`/settings/wallet`). No
   new payment flow needed; the same NGN wallet funds SMS, storage and email.

4. **"Buy more emails" UX** — the dashboard card and the communication page show
   remaining free emails and, when low/zero, a "buy more" nudge that just points
   to wallet top-up (since it's one shared balance).

## Edge cases to handle

- Allowance = null (Enterprise) → never charge, never block.
- Partial batches: only charge for emails **actually sent** (mirror how
  `sendChurchSmsBatch` debits only successful sends).
- Concurrency: compute cost and debit inside a DB transaction; re-check balance
  at debit time.
- A church at/over allowance that sends a **transactional** email (OTP, reset,
  reminder) must still send — those paths never call the metered function.

## Rollout plan (low-risk)

1. Ship the price setting + superadmin control (like SMS price) — no behaviour
   change yet.
2. Turn on charging behind a platform flag, defaulting **off**, so you can enable
   it per environment and watch logs.
3. Enable in production during low traffic; monitor that transactional email is
   untouched and only Communication/event-guest sends debit the wallet.

## My recommendation

Build steps 1–2 of the model, keep transactional email 100% free and unmetered,
price in **NGN** (₦16/email ≈ $1/100) via a tunable setting, and gate the whole
thing behind a flag for a controlled rollout. I can implement this next once you
confirm the price and that the scope (Communication + event guests only) is what
you want.
