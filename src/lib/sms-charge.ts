import { smsPages } from "@/lib/sms-pages";

/**
 * The money maths of a church SMS send, apart from the sending so it can be
 * tested on its own.
 *
 * HOLD, SEND, SETTLE. The whole cost is taken from the wallet BEFORE anything
 * reaches the gateway - one conditional UPDATE, so two sends that each fit the
 * balance on their own cannot both pass when together they do not - and
 * whatever could not be sent is credited back afterwards. The old order (read
 * the balance, send for minutes, write `balance - spent` back) erased any
 * top-up or other charge that landed in between.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What one message costs across `recipients` people, to the kobo. */
export function smsCost(message: string, recipients: number, price: number): number {
  return round2(price * smsPages(message) * recipients);
}

/** The cost of a batch: each personalised message priced on its own pages. */
export function batchCost(messages: readonly string[], price: number): number {
  return round2(messages.reduce((s, m) => s + price * smsPages(m), 0));
}

export type GroupOutcome = {
  ok: boolean;
  /**
   * Not confirmed either way - the call timed out, or its answer was lost -
   * so the gateway may have sent it. Charged like a sent group and never
   * refunded: refunding it is what let the queue send the same row again for
   * free, and texted a congregation three times. See sms-gateway-outcome.ts.
   */
  uncertain?: boolean;
  /** How many people this gateway call was for. */
  count: number;
  /** Pages per message in this group. */
  pages: number;
};

/**
 * Settle a batch against what was held.
 *
 * `spent` is priced from the pages that went or may have gone, `refund` is
 * the rest of the hold. Never negative: if rounding ever made the groups add
 * up to a kobo more than the hold, the church is not charged the difference.
 * `pages` counts the same pages, since those are what Termii bills us for.
 */
export function settleBatch(
  held: number,
  groups: readonly GroupOutcome[],
  price: number,
): {
  sent: number;
  failed: number;
  unconfirmed: number;
  pages: number;
  spent: number;
  refund: number;
} {
  let sent = 0;
  let failed = 0;
  let unconfirmed = 0;
  let pages = 0;
  for (const g of groups) {
    if (g.ok) {
      sent += g.count;
      pages += g.pages * g.count;
    } else if (g.uncertain) {
      unconfirmed += g.count;
      pages += g.pages * g.count;
    } else {
      failed += g.count;
    }
  }
  const spent = Math.min(round2(price * pages), round2(held));
  const refund = Math.max(0, round2(held - spent));
  return { sent, failed, unconfirmed, pages, spent, refund };
}
