import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { smsAvailableForCountry } from "@/lib/sms-availability";
import { church } from "@/db/schema";
import { sendSms, smsPages, normalizePhone, isSmsConfigured } from "@/lib/sms";
import { getSmsPrice } from "@/lib/platform-settings";
import { recordUsage } from "@/lib/usage";
import { SMS_WINDOW_LABEL, withinSmsWindow } from "@/lib/sms-window";
import { creditWallet, debitWallet } from "@/lib/wallet";
import { batchCost, settleBatch, smsCost } from "@/lib/sms-charge";
import { mapLimit } from "@/lib/concurrency";
import type { QueuedResult } from "@/lib/sms-queue";

/*
 * MONEY: HOLD, SEND, SETTLE.
 *
 * Both senders used to read the wallet balance, call the gateway (one call per
 * personalised message, so minutes for a congregation), and then write
 * `balance - spent` back as an absolute figure. Anything that touched the
 * wallet in between was erased: a Paystack top-up made while a reminder batch
 * was going out vanished from the balance while its ledger row stayed, and two
 * sends started together were charged once between them. Two sends that each
 * fitted the balance also both passed a check that together they failed.
 *
 * Now the cost is held first, through debitWallet - one UPDATE whose WHERE is
 * the "enough money?" check, judged on the row under its lock - and whatever
 * did not go out is credited back afterwards through creditWallet. Neither
 * ever writes a balance computed from an earlier read.
 */

/** How many gateway calls one batch may have open at once. */
const SMS_SEND_CONCURRENCY = (() => {
  const n = Number(process.env.SMS_SEND_CONCURRENCY);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
})();

function notEnough(cost: number, balance: number): { ok: false; error: string } {
  return {
    ok: false,
    error: `Not enough SMS balance. This needs ${cost.toFixed(2)} but your balance is ${balance.toFixed(2)}.`,
  };
}

/**
 * Give back the part of a hold that was not spent. A refund that fails is a
 * church over-charged, so it is logged with every figure needed to put it
 * right by hand - never swallowed.
 */
async function refundUnsent(opts: {
  churchId: string;
  amount: number;
  reason: string;
  userId?: string;
}): Promise<number | null> {
  if (opts.amount <= 0) return null;
  try {
    return await creditWallet({
      churchId: opts.churchId,
      amount: opts.amount,
      category: "refund",
      reason: opts.reason.slice(0, 200),
      createdBy: opts.userId ?? null,
    });
  } catch (e) {
    console.error(
      `[church-sms] REFUND FAILED: church ${opts.churchId} is owed ${opts.amount.toFixed(2)} (${opts.reason})`,
      e,
    );
    return null;
  }
}

export type ChurchSmsResult =
  | { ok: true; cost: number; balance: number }
  /**
   * Accepted, but held for the delivery window. Nothing has been charged.
   *
   * Deliberately a THIRD outcome rather than `ok: true` with zero sent: a
   * caller that treated it as sent would tell somebody their message had gone,
   * and one that treated it as a failure would have them send it again. Its own
   * shape forces every call site to say which it means.
   */
  | QueuedResult
  /**
   * `uncertain`: the gateway may have sent it (a timeout, a lost answer), so
   * it was kept charged and must not be sent again. See sms-gateway-outcome.ts.
   * `duplicate`: this very send is already queued.
   */
  | { ok: false; error: string; uncertain?: boolean; duplicate?: boolean };

/**
 * Send SMS on behalf of a church: requires an approved sender ID and enough
 * wallet balance. Deducts cost (price × pages × recipients) and records a
 * ledger entry. Used by follow-up and any future broadcast features.
 */
export async function sendChurchSms(opts: {
  churchId: string;
  to: string | string[];
  message: string;
  userId?: string;
  reason?: string;
  /**
   * What to do outside the 8am-8pm delivery window.
   *
   *  "queue"  (default) park it until the window opens.
   *  "refuse" don't send and don't queue - say plainly that it cannot go.
   *           For anything with a short life, like a verification code: it
   *           would expire long before 8am, so queueing it is the same as
   *           losing it, and sending it is the same as dropping it.
   *  "now"    hand it over regardless. Only for a caller that has already
   *           checked the window itself (the queue worker).
   */
  timing?: "queue" | "now" | "refuse";
  /** Which sender queued it, so a surprise in the queue can be traced. */
  origin?: string;
  /** The audience label the queue shows. Falls back to `reason`. */
  audience?: string;
}): Promise<ChurchSmsResult> {
  if (!isSmsConfigured()) {
    return { ok: false, error: "SMS isn't enabled on the platform yet." };
  }

  const [c] = await db
    .select({
      senderId: church.smsSenderId,
      status: church.smsSenderStatus,
      balance: church.walletBalance,
      country: church.country,
      timezone: church.timezone,
    })
    .from(church)
    .where(eq(church.id, opts.churchId))
    .limit(1);
  if (!c) return { ok: false, error: "Church not found." };

  /*
   * The country gate, enforced HERE rather than only in the UI.
   *
   * Hiding a button is not a gate: the crons send SMS too — service reminders,
   * celebrations, pledge chasers, first-timer welcomes — and none of them pass
   * through a screen anybody hid. A church outside Nigeria would have had
   * those charged to its wallet and delivered nowhere.
   *
   * The message says the real reason. Without this the caller fell through to
   * "your sender ID isn't approved yet", which sends somebody to a settings
   * page to fix something that is not the problem and cannot be fixed there.
   */
  if (!smsAvailableForCountry(c.country)) {
    return {
      ok: false,
      error:
        "SMS isn't available in your country yet, so nothing was sent or charged. Email is free and unlimited — use that to reach everybody.",
    };
  }

  if (c.status !== "approved" || !c.senderId) {
    return {
      ok: false,
      error: "Your SMS sender ID isn't approved yet. Apply in Settings → SMS.",
    };
  }

  const recipients = (Array.isArray(opts.to) ? opts.to : [opts.to])
    .map(normalizePhone)
    .filter((n): n is string => !!n);
  if (recipients.length === 0)
    return { ok: false, error: "No valid phone number to send to." };

  /*
   * The delivery window, checked HERE for the same reason the country gate is:
   * the crons send too, and none of them passes through a screen anybody could
   * have put a warning on. A 9pm message handed to the gateway is charged and
   * dropped, so the only honest options are to refuse it or to hold it - and
   * holding it is what the person who pressed Send actually wanted.
   */
  const timing = opts.timing ?? "queue";
  if (timing !== "now" && !withinSmsWindow(new Date(), c.timezone)) {
    if (timing === "refuse")
      return {
        ok: false,
        error: `Networks only deliver SMS between ${SMS_WINDOW_LABEL}, so a code can't be sent by text right now. Please use an email address instead.`,
      };
    const { queueChurchSms } = await import("@/lib/sms-queue");
    return queueChurchSms({
      churchId: opts.churchId,
      timezone: c.timezone,
      audience: opts.audience ?? opts.reason ?? `${recipients.length} recipient(s)`,
      body: opts.message,
      recipients: recipients.map((phone) => ({ phone, message: opts.message })),
      origin: opts.origin ?? "automated",
      reason: opts.reason,
      userId: opts.userId,
    });
  }

  const price = await getSmsPrice();
  const cost = smsCost(opts.message, recipients.length, price);
  const reason = opts.reason ?? `SMS to ${recipients.length} recipient(s)`;

  // Hold the cost before the gateway sees anything. See MONEY above.
  let balance = Number(c.balance);
  if (cost > 0) {
    const hold = await debitWallet({
      churchId: opts.churchId,
      amount: cost,
      category: "sms",
      reason,
      createdBy: opts.userId ?? null,
    });
    if (!hold.ok) return notEnough(cost, hold.balance);
    balance = hold.balance;
  }

  const result = await sendSms({
    to: recipients,
    message: opts.message,
    senderId: c.senderId,
  });
  if (!result.ok && result.uncertain) {
    /*
     * It may have gone. Kept charged and NOT refunded: a refund here reads as
     * "nothing happened", which is the invitation to send it again and text
     * the same people twice. The usage meter counts it too, because Termii
     * will have billed us for it if it went.
     */
    console.error(
      `[church-sms] church ${opts.churchId}: ${recipients.length} message(s) not confirmed by the gateway; kept charged (${cost.toFixed(2)}): ${result.error}`,
    );
    await recordUsage("sms", opts.churchId, recipients.length);
    await recordUsage("sms_pages", opts.churchId, smsPages(opts.message) * recipients.length);
    return result;
  }
  if (!result.ok) {
    // Nothing went, so nothing is owed: the whole hold goes back.
    await refundUnsent({
      churchId: opts.churchId,
      amount: cost,
      reason: `Refund: SMS not sent (${result.error})`,
      userId: opts.userId,
    });
    return result;
  }

  await recordUsage("sms", opts.churchId, recipients.length);
  // Pages, not recipients — a 300-character message is 2 pages per recipient,
  // and only the page count reconciles against what Termii charges us.
  await recordUsage(
    "sms_pages",
    opts.churchId,
    smsPages(opts.message) * recipients.length,
  );
  return { ok: true, cost, balance };
}

/** What happened to one phone number in a batch. `phone` is the number as it
 *  was given to us, so the caller can match it back to a person. */
export type SmsOutcome = {
  phone: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
  /** Termii's id for this message, so a delivery report can be matched to it. */
  providerMessageId?: string | null;
  /**
   * The gateway did not confirm this one either way (a timeout, a lost
   * answer), so it may have gone. Reported as "sent", with `error` saying it
   * is unconfirmed, because that is how every caller treats it correctly: it
   * was charged, it must never be retried, and the delivery report - which
   * matches a "sent" row by phone number - settles what really happened.
   */
  unconfirmed?: boolean;
};

export type BatchSmsResult =
  | QueuedResult
  | {
      ok: true;
      /** Confirmed by the gateway. */
      sent: number;
      failed: number;
      /**
       * Neither confirmed nor refused - the call timed out or its answer was
       * lost. Charged, never refunded and never to be retried: it may have
       * gone. Their outcomes are "sent" with `unconfirmed` set.
       */
      unconfirmed: number;
      /** Numbers we never attempted because they weren't usable. */
      skipped: number;
      cost: number;
      /** Pages that went or may have gone - what the usage meter and Termii count. */
      pages: number;
      balance: number;
      outcomes: SmsOutcome[];
    }
  | { ok: false; error: string; duplicate?: boolean };

/**
 * Send (possibly personalised) SMS to many recipients. Groups identical
 * messages into one gateway call, checks the wallet once for the whole batch,
 * deducts the cost of successfully-sent messages and records one ledger entry.
 */
export async function sendChurchSmsBatch(opts: {
  churchId: string;
  recipients: {
    phone: string;
    message: string;
    /** Carried through the queue so a delayed send still names the person. */
    memberId?: string | null;
    name?: string | null;
  }[];
  userId?: string;
  label?: string;
  /**
   * See sendChurchSms - "now" ignores the window, "refuse" rejects.
   *
   * "background" is for a send too big to finish inside one web request: a
   * personalised message to a congregation is one gateway call per person, and
   * behind Cloudflare's 100-second limit the person who pressed Send saw an
   * error while the server carried on texting - so they pressed it again. It
   * is checked here (sender, country, balance) and then handed to the SMS
   * queue due now; the caller starts the queue worker after its response.
   * Outside the window it is queued for the morning, exactly like "queue".
   */
  timing?: "queue" | "now" | "refuse" | "background";
  origin?: string;
  /**
   * One press of Send, from the composer. Only a queued send carries it, and
   * the queue refuses a second row with the same id - so a retry after a
   * timeout cannot text the congregation twice.
   */
  requestId?: string | null;
}): Promise<BatchSmsResult> {
  if (!isSmsConfigured())
    return { ok: false, error: "SMS isn't enabled on the platform yet." };

  const [c] = await db
    .select({
      senderId: church.smsSenderId,
      status: church.smsSenderStatus,
      balance: church.walletBalance,
      country: church.country,
      timezone: church.timezone,
    })
    .from(church)
    .where(eq(church.id, opts.churchId))
    .limit(1);
  if (!c) return { ok: false, error: "Church not found." };

  // The same gate as the single send, and this is the path that matters most:
  // the crons send in batches, so an unguarded bulk reminder is where a church
  // outside Nigeria would be charged for a hundred messages at once.
  if (!smsAvailableForCountry(c.country))
    return {
      ok: false,
      error:
        "SMS isn't available in your country yet, so nothing was sent or charged. Email is free and unlimited — use that to reach everybody.",
    };

  if (c.status !== "approved" || !c.senderId)
    return {
      ok: false,
      error: "Your SMS sender ID isn't approved yet. Apply in Settings → SMS.",
    };

  /*
   * Outside the window: hold the whole batch and charge nothing.
   *
   * Queued BEFORE normalising, on purpose - what goes out at 8am is then
   * exactly the list that was approved now, not a list re-resolved in the
   * morning after somebody was added to the group.
   */
  const timing = opts.timing ?? "queue";
  const inWindow = withinSmsWindow(new Date(), c.timezone);
  if ((timing !== "now" && !inWindow) || timing === "background") {
    if (timing === "refuse")
      return {
        ok: false,
        error: `Networks only deliver SMS between ${SMS_WINDOW_LABEL}, so this can't be sent by text right now.`,
      };
    if (timing === "background" && inWindow) {
      /*
       * Going now, but after the response. Say "not enough balance" here,
       * while the person is still looking, rather than from a worker nobody
       * is watching. The real hold is still taken when it sends.
       */
      const usable = opts.recipients.filter((r) => normalizePhone(r.phone));
      if (usable.length === 0)
        return { ok: false, error: "No valid phone numbers to send to." };
      const estimate = batchCost(
        usable.map((r) => r.message),
        await getSmsPrice(),
      );
      if (Number(c.balance) < estimate) return notEnough(estimate, Number(c.balance));
    }
    const { queueChurchSms } = await import("@/lib/sms-queue");
    return queueChurchSms({
      churchId: opts.churchId,
      timezone: c.timezone,
      audience: opts.label ?? `${opts.recipients.length} recipient(s)`,
      // The first message stands for the batch in the history; every recipient
      // still keeps their own personalised copy.
      body: opts.recipients[0]?.message ?? "",
      recipients: opts.recipients,
      origin: opts.origin ?? "automated",
      reason: opts.label,
      userId: opts.userId,
      requestId: opts.requestId ?? null,
      sendNow: timing === "background" && inWindow,
    });
  }

  // Normalise. An unusable number is reported back as "skipped" rather than
  // silently dropped — otherwise a send to 120 quietly becomes a send to 116
  // and nobody can tell which four were left out.
  const outcomes: SmsOutcome[] = [];
  const valid: { phone: string; original: string; message: string }[] = [];
  for (const r of opts.recipients) {
    const phone = normalizePhone(r.phone);
    if (!phone) {
      outcomes.push({
        phone: r.phone,
        status: "skipped",
        error: "Not a usable phone number",
      });
      continue;
    }
    valid.push({ phone, original: r.phone, message: r.message });
  }
  if (valid.length === 0)
    return { ok: false, error: "No valid phone numbers to send to." };

  const price = await getSmsPrice();
  const totalCost = batchCost(
    valid.map((r) => r.message),
    price,
  );

  // Hold the whole batch's cost before the first call. See MONEY above.
  let balance = Number(c.balance);
  if (totalCost > 0) {
    const hold = await debitWallet({
      churchId: opts.churchId,
      amount: totalCost,
      category: "sms",
      reason: opts.label ?? `Bulk SMS to ${valid.length} recipient(s)`,
      createdBy: opts.userId ?? null,
    });
    if (!hold.ok) return notEnough(totalCost, hold.balance);
    balance = hold.balance;
  }

  // Group identical messages → one gateway call each.
  const groups = new Map<string, { phone: string; original: string }[]>();
  for (const r of valid) {
    const arr = groups.get(r.message) ?? [];
    arr.push({ phone: r.phone, original: r.original });
    groups.set(r.message, arr);
  }
  const groupList = [...groups];
  const senderId = c.senderId;

  /*
   * A few calls at a time rather than one after another. A personalised
   * message is one group per person, so 400 members was 400 calls in a row -
   * minutes. sendSms never throws (it reports failure as ok:false, and has its
   * own timeout), but a rejection is still recorded below, never dropped.
   */
  const results = await mapLimit(groupList, SMS_SEND_CONCURRENCY, ([message, people]) =>
    sendSms({ to: people.map((p) => p.phone), message, senderId }),
  );

  const verdicts = results.map((settledCall) =>
    settledCall.status === "fulfilled"
      ? settledCall.value
      : ({
          ok: false,
          // sendSms never throws, so this is our own code failing around
          // the call - which may already have been made. Not refunded.
          error: `The send stopped on an internal error, so this may have gone: ${String((settledCall.reason as Error)?.message ?? settledCall.reason)}`,
          uncertain: true,
        } as const),
  );
  verdicts.forEach((res, gi) => {
    const people = groupList[gi][1];
    if (res.ok) {
      // One call covers the whole group, so the gateway's verdict applies to
      // every number in it. Termii returns its ids in the same order we sent
      // the numbers — an assumption, so a missing id is left null and the
      // delivery webhook falls back to matching on the phone number.
      for (const [i, p] of people.entries())
        outcomes.push({
          phone: p.original,
          status: "sent",
          providerMessageId: res.ids[i] ?? null,
        });
    } else if (res.uncertain) {
      for (const p of people)
        outcomes.push({
          phone: p.original,
          status: "sent",
          unconfirmed: true,
          error: `Not confirmed: ${res.error}`,
          providerMessageId: null,
        });
    } else {
      for (const p of people)
        outcomes.push({ phone: p.original, status: "failed", error: res.error });
    }
  });

  const settled = settleBatch(
    totalCost,
    verdicts.map((res, gi) => ({
      ok: res.ok,
      uncertain: !res.ok && !!res.uncertain,
      count: groupList[gi][1].length,
      pages: smsPages(groupList[gi][0]),
    })),
    price,
  );
  const { sent, failed, unconfirmed, spent, pages: pagesSent } = settled;
  if (unconfirmed > 0)
    console.error(
      `[church-sms] church ${opts.churchId}: ${unconfirmed} of ${valid.length} message(s) not confirmed by the gateway; kept charged, not retried`,
    );

  // Give back what did not go: charged only for what the gateway took.
  if (settled.refund > 0) {
    const after = await refundUnsent({
      churchId: opts.churchId,
      amount: settled.refund,
      reason: `Refund: ${failed} of ${valid.length} SMS could not be sent`,
      userId: opts.userId,
    });
    if (after != null) balance = after;
  }

  if (sent + unconfirmed > 0) await recordUsage("sms", opts.churchId, sent + unconfirmed);
  if (pagesSent > 0) await recordUsage("sms_pages", opts.churchId, pagesSent);
  return {
    ok: true,
    sent,
    failed,
    unconfirmed,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    cost: spent,
    pages: pagesSent,
    balance,
    outcomes,
  };
}
