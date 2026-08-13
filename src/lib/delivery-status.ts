/**
 * Mapping provider delivery reports onto our own delivery_status enum.
 *
 * Pure — no imports — so every provider status can be unit-tested without a
 * database or a network call.
 *
 * Unknown values return null and are ignored rather than guessed: a provider
 * adding a new status must not silently be recorded as "delivered".
 */

export type DeliveryState = "sent" | "delivered" | "undelivered";

const TERMII: Record<string, DeliveryState> = {
  delivered: "delivered",
  "message sent": "sent",
  received: "sent",
  "dnd active on phone number": "undelivered",
  rejected: "undelivered",
  expired: "undelivered",
  "message failed": "undelivered",
};

/** Termii's `status` field → our state. Null when unrecognised. */
export function mapTermiiStatus(raw: string): DeliveryState | null {
  return TERMII[(raw ?? "").trim().toLowerCase()] ?? null;
}

const RESEND: Record<string, DeliveryState> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.bounced": "undelivered",
  "email.failed": "undelivered",
  "email.suppressed": "undelivered",
  // Deliberately absent (accepted and ignored): opened, clicked, complained,
  // delivery_delayed, scheduled. Delivery-only by decision — no tracking
  // pixels or rewritten links in church email.
};

/** Resend's event `type` → our state. Null when we don't record it. */
export function mapResendEvent(type: string): DeliveryState | null {
  return RESEND[(type ?? "").trim().toLowerCase()] ?? null;
}

/** A human-readable reason for a recipient who didn't receive the message. */
export function termiiReason(raw: string): string | null {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "dnd active on phone number":
      return "Blocked — this number is on the DND list";
    case "rejected":
      return "Rejected by the network";
    case "expired":
      return "Expired before it could be delivered";
    case "message failed":
      return "The network could not deliver it";
    default:
      return null;
  }
}

export function resendReason(type: string): string | null {
  switch ((type ?? "").trim().toLowerCase()) {
    case "email.bounced":
      return "Bounced — the address rejected it";
    case "email.failed":
      return "Failed to send";
    case "email.suppressed":
      return "Suppressed — previously bounced or complained";
    default:
      return null;
  }
}

/** Rank used to stop a late report undoing a better one. */
const RANK: Record<DeliveryState, number> = {
  sent: 1,
  undelivered: 2,
  delivered: 3,
};

/**
 * Should `next` replace `current`?
 *
 * Reports arrive out of order, so a "Message Sent" landing after "DELIVERED"
 * must not drag the row backwards. Terminal states (delivered/undelivered)
 * beat "sent"; between the two terminal states the newer one wins, because a
 * message can genuinely be reported delivered and later bounce.
 */
export function shouldApply(
  current: string | null | undefined,
  next: DeliveryState,
): boolean {
  if (!current) return true;
  // Never overwrite an operator-visible skip or a hard local failure: those
  // were decided before the message ever left us.
  if (current === "skipped" || current === "failed") return false;
  const from = RANK[current as DeliveryState];
  if (from === undefined) return true;
  if (next === "sent") return false;
  return true;
}
