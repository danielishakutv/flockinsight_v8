/**
 * What a Paystack verify answer means for a payment we are waiting on.
 *
 * Pure, so the rule that decides whether money is credited can be tested
 * without a network or a database — and so the browser callback, the webhook,
 * the reconcile cron and anything after them read the answer the same way.
 *
 * The rule that cost money before: "anything that is not success is failed".
 * A bank transfer or USSD payment is `ongoing`/`pending` for minutes after the
 * payer is sent back, and a verify that times out says nothing at all — yet
 * both used to mark the row failed, which nothing ever revisited. Only a
 * DEFINITE answer may fail a payment; everything else leaves it pending for
 * the webhook or the cron to settle.
 */

export type VerifyAnswer =
  | {
      ok: true;
      status: string;
      /** Whole kobo, exactly as Paystack reported it. */
      amountKobo: number;
      currency: string;
    }
  | { ok: false; error: string };

export type ChargeOutcome =
  /** Paid, in full, in naira. Safe to honour. */
  | "success"
  /** Paystack has not finished (transfer in flight, USSD, 3-D Secure). */
  | "pending"
  /** Paystack says it will not complete: failed, reversed or abandoned. */
  | "failed"
  /** It succeeded, but for less than we asked, or not in naira. A human looks. */
  | "mismatch"
  /** We could not get an answer at all. Says nothing about the payment. */
  | "unknown";

/** Paystack's terminal non-success states. */
const DEAD = new Set(["failed", "reversed", "abandoned"]);

/** Naira to whole kobo, the way paystackInit sent it. */
export function toKobo(naira: number): number {
  return Math.round(Number(naira) * 100);
}

export function classifyCharge(
  v: VerifyAnswer,
  expectedNaira: number,
): ChargeOutcome {
  if (!v.ok) return "unknown";
  const status = String(v.status || "").toLowerCase();
  if (status === "success") {
    /*
     * Amount and currency are checked against what WE asked for, not what the
     * row was later edited to say. Paying less than the charge — a tampered
     * checkout, or a partial transfer — must not buy the whole period.
     * Paying more is honoured: the money is ours either way and the overpay
     * is visible on the row.
     */
    if (String(v.currency || "").toUpperCase() !== "NGN") return "mismatch";
    if (v.amountKobo < toKobo(expectedNaira)) return "mismatch";
    return "success";
  }
  if (DEAD.has(status)) return "failed";
  return "pending";
}

/** Which of our three Paystack products a reference belongs to. */
export type ReferenceKind = "subscription" | "wallet" | "sms" | null;

export function referenceKind(reference: string): ReferenceKind {
  if (reference.startsWith("FI-")) return "subscription";
  if (reference.startsWith("WAL-")) return "wallet";
  if (reference.startsWith("SMS-")) return "sms";
  return null;
}

/** What settling one reference did. Shared by subscriptions and top-ups. */
export type SettleResult =
  | "success" // honoured by this call
  | "already" // honoured before (or concurrently, by someone else)
  | "pending" // Paystack has not finished; try again later
  | "failed" // Paystack says it will not complete (or it was voided)
  | "mismatch" // paid, but not what we asked for; left for a human
  | "unknown" // Paystack could not be asked; nothing changed
  | "not-found"; // not a reference we issued

/** Where a settle result sends the person who just paid: the ?status= value. */
export function callbackStatus(r: SettleResult): "success" | "failed" | "pending" | "error" {
  if (r === "success" || r === "already") return "success";
  if (r === "failed") return "failed";
  // Still in flight, unverifiable right now, or held for review: none of
  // these is a failure, and saying "failed" is what made people pay twice.
  if (r === "pending" || r === "unknown" || r === "mismatch") return "pending";
  return "error";
}
