/**
 * Database-backed checks for what a church SMS send does to the wallet, and
 * for the queue's double-submit guard. Run with `pnpm test:db`.
 *
 * The senders used to read the balance, call the gateway for as long as a
 * personalised batch takes (minutes), and then write `balance - spent` back as
 * an absolute figure: a Paystack top-up that landed in between was erased, and
 * two sends started together could both pass a balance check that together
 * they failed. Now the cost is HELD (a conditional debit) before the gateway
 * is called and the unsent part is refunded after.
 *
 * A call the gateway did not answer in time may still have been delivered, so
 * it is kept charged and never retried - the last block checks both.
 *
 * Each race below is deliberately interleaved (AGENTS.md): the gateway call is
 * held open on a gate while the competing movement runs against the same row.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, scheduledSms, walletTxn } from "@/db/schema";

/** A promise and the function that resolves it. */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
}

// The gateway: refuses numbers in `refuse`, times out on numbers in
// `timeout` (as the real sendSms reports a call it stopped waiting for), throws
// on numbers in `explode`, and waits on `hold` when set.
const gateway = {
  refuse: new Set<string>(),
  timeout: new Set<string>(),
  explode: new Set<string>(),
  hold: null as Promise<void> | null,
  started: null as (() => void) | null,
  calls: 0,
};

vi.mock("@/lib/sms", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/sms")>();
  return {
    ...real,
    isSmsConfigured: () => true,
    sendSms: async (opts: { to: string | string[]; message: string }) => {
      gateway.calls++;
      gateway.started?.();
      if (gateway.hold) await gateway.hold;
      const to = (Array.isArray(opts.to) ? opts.to : [opts.to]).map(
        (n) => real.normalizePhone(n) as string,
      );
      if (to.some((n) => gateway.explode.has(n))) throw new Error("zzcheck: thrown mid-call");
      if (to.some((n) => gateway.timeout.has(n))) {
        // Exactly what sendSms returns when its AbortSignal.timeout fires.
        const { classifySendThrow } = await import("@/lib/sms-gateway-outcome");
        const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
          name: "TimeoutError",
        });
        return { ok: false as const, ...classifySendThrow(timeout, 30) };
      }
      if (to.some((n) => gateway.refuse.has(n)))
        return { ok: false as const, error: "SMS not sent: refused by the zzcheck gateway" };
      return { ok: true as const, ids: to.map((_, i) => `zz-${i}`) };
    },
  };
});
vi.mock("@/lib/platform-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform-settings")>()),
  getSmsPrice: async () => 4,
}));
vi.mock("@/lib/sms-window", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sms-window")>()),
  // Always inside 8am-8pm, so the checks do not depend on the clock.
  withinSmsWindow: () => true,
}));
// The usage meter writes rows of its own; not what is under test here.
vi.mock("@/lib/usage", () => ({ recordUsage: async () => {} }));

const { sendChurchSms, sendChurchSmsBatch } = await import("@/lib/church-sms");
const { creditWallet, getWalletBalance } = await import("@/lib/wallet");
const { queueChurchSms, sendQueuedSmsNow } = await import("@/lib/sms-queue");

const stamp = Date.now();
const CHURCH = `zzcheck-sms-${stamp}`;
const queueIds: string[] = [];

beforeAll(async () => {
  await db.insert(church).values({
    id: CHURCH,
    name: `ZZ SMS ${stamp}`,
    slug: `zzcheck-sms-${stamp}`,
    handle: `zzcheck-sms-${stamp}`,
    country: "Nigeria",
    smsSenderId: "ZZCHECK",
    smsSenderStatus: "approved",
    walletBalance: 0,
  });
});

afterAll(async () => {
  // Only what this file made, by id.
  if (queueIds.length) await db.delete(scheduledSms).where(inArray(scheduledSms.id, queueIds));
  await db.delete(walletTxn).where(eq(walletTxn.churchId, CHURCH));
  await db.delete(church).where(eq(church.id, CHURCH));
});

async function reset(to: number) {
  await db.update(church).set({ walletBalance: to }).where(eq(church.id, CHURCH));
  await db.delete(walletTxn).where(eq(walletTxn.churchId, CHURCH));
  gateway.refuse.clear();
  gateway.timeout.clear();
  gateway.explode.clear();
  gateway.hold = null;
  gateway.started = null;
  gateway.calls = 0;
}

async function ledgerNet(): Promise<number> {
  const rows = await db
    .select({ kind: walletTxn.kind, amount: walletTxn.amount })
    .from(walletTxn)
    .where(eq(walletTxn.churchId, CHURCH));
  return +rows
    .reduce((s, r) => s + (r.kind === "credit" ? 1 : -1) * Number(r.amount), 0)
    .toFixed(2);
}

const people = [
  { phone: "08030000001", message: "Hi Ada, see you Sunday." },
  { phone: "08030000002", message: "Hi Bola, see you Sunday." },
  { phone: "08030000003", message: "Hi Chi, see you Sunday." },
];

describe("church SMS and the wallet", () => {
  it("keeps a top-up that lands while a batch is being sent", async () => {
    await reset(100);
    const held = gate();
    const inGateway = gate();
    gateway.hold = held.p;
    gateway.started = inGateway.open;

    const batch = sendChurchSmsBatch({ churchId: CHURCH, recipients: people, timing: "now" });
    await inGateway.p; // the hold is taken and the gateway call is open
    await creditWallet({ churchId: CHURCH, amount: 1000, category: "topup", reason: "zzcheck" });
    held.open();
    const res = await batch;

    expect(res.ok).toBe(true);
    if (res.ok !== true) return;
    expect(res.sent).toBe(3);
    expect(res.cost).toBe(12);
    // 100 + 1000 - 12. The old absolute write left 88 and lost the top-up.
    expect(await getWalletBalance(CHURCH)).toBe(1088);
    expect(await ledgerNet()).toBe(988);
  });

  it("charges only for what the gateway took, and refunds the rest", async () => {
    await reset(100);
    gateway.refuse.add("2348030000002");
    const res = await sendChurchSmsBatch({ churchId: CHURCH, recipients: people, timing: "now" });
    expect(res.ok).toBe(true);
    if (res.ok !== true) return;
    expect(res.sent).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.cost).toBe(8);
    expect(await getWalletBalance(CHURCH)).toBe(92);
    expect(await ledgerNet()).toBe(-8);
  });

  it("does not let two sends spend money that only covers one", async () => {
    await reset(15); // each batch costs 12
    const held = gate();
    const inGateway = gate();
    gateway.hold = held.p;
    gateway.started = inGateway.open;

    const first = sendChurchSmsBatch({ churchId: CHURCH, recipients: people, timing: "now" });
    await inGateway.p; // first has its hold; its gateway call is still open
    gateway.started = null;
    const second = await sendChurchSmsBatch({
      churchId: CHURCH,
      recipients: people,
      timing: "now",
    });
    held.open();
    const firstRes = await first;

    expect(firstRes.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (second.ok === false) expect(second.error).toMatch(/Not enough SMS balance/);
    expect(await getWalletBalance(CHURCH)).toBe(3);
  });

  it("refunds a single send the gateway refused", async () => {
    await reset(50);
    gateway.refuse.add("2348030000009");
    const res = await sendChurchSms({
      churchId: CHURCH,
      to: "08030000009",
      message: "Hello",
      timing: "now",
    });
    expect(res.ok).toBe(false);
    expect(await getWalletBalance(CHURCH)).toBe(50);
    expect(await ledgerNet()).toBe(0);
  });
});

describe("a gateway that timed out may still have sent", () => {
  it("keeps the batch charged and reports it unconfirmed, not failed", async () => {
    await reset(100);
    gateway.timeout.add("2348030000002");
    const res = await sendChurchSmsBatch({ churchId: CHURCH, recipients: people, timing: "now" });
    expect(res.ok).toBe(true);
    if (res.ok !== true) return;
    expect(res.sent).toBe(2);
    expect(res.unconfirmed).toBe(1);
    expect(res.failed).toBe(0);
    // All three charged: the timed-out one may have gone, and a refund is what
    // let the queue send it again for nothing.
    expect(res.cost).toBe(12);
    expect(await getWalletBalance(CHURCH)).toBe(88);
    const bola = res.outcomes.find((o) => o.phone === "08030000002");
    expect(bola?.status).toBe("sent");
    expect(bola?.unconfirmed).toBe(true);
    expect(bola?.error).toMatch(/Not confirmed/);
  });

  it("treats a call that threw as unconfirmed, never as refunded", async () => {
    await reset(100);
    gateway.explode.add("2348030000003");
    const res = await sendChurchSmsBatch({ churchId: CHURCH, recipients: people, timing: "now" });
    expect(res.ok).toBe(true);
    if (res.ok !== true) return;
    expect(res.unconfirmed).toBe(1);
    expect(await getWalletBalance(CHURCH)).toBe(88);
  });

  it("does not refund a single send that timed out", async () => {
    await reset(50);
    gateway.timeout.add("2348030000009");
    const res = await sendChurchSms({
      churchId: CHURCH,
      to: "08030000009",
      message: "Hello",
      timing: "now",
    });
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.uncertain).toBe(true);
    expect(await getWalletBalance(CHURCH)).toBe(46);
  });

  it("never puts a timed-out queue row back for another go", async () => {
    await reset(100);
    // One message to everybody: ONE gateway call, as an 8am notice is.
    const same = people.map((p) => ({ ...p, message: "Service moved to 9am." }));
    for (const p of same) gateway.timeout.add(`234${p.phone.slice(1)}`);
    const q = await queueChurchSms({
      churchId: CHURCH,
      timezone: "Africa/Lagos",
      audience: "zzcheck timeout",
      body: "Service moved to 9am.",
      recipients: same,
      origin: "zzcheck",
      sendNow: true,
    });
    expect(q.ok).toBe("queued");
    if (q.ok !== "queued") return;
    queueIds.push(q.id);

    await sendQueuedSmsNow(q.id);
    const [row] = await db
      .select({ status: scheduledSms.status, error: scheduledSms.error })
      .from(scheduledSms)
      .where(eq(scheduledSms.id, q.id));
    // The old verdict saw "0 sent, 3 failed", refunded, and requeued it.
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/did not confirm 3 of 3/);
    expect(gateway.calls).toBe(1);
    expect(await getWalletBalance(CHURCH)).toBe(88);
  });
});

describe("the queue's double-submit guard", () => {
  it("refuses a second row for the same press of Send", async () => {
    const requestId = `zzcheck-req-${stamp}`;
    const base = {
      churchId: CHURCH,
      timezone: "Africa/Lagos",
      audience: "zzcheck",
      body: "Hello",
      recipients: [{ phone: "08030000001", message: "Hello" }],
      origin: "communication",
      requestId,
      sendNow: true,
    };
    const one = await queueChurchSms(base);
    expect(one.ok).toBe("queued");
    if (one.ok === "queued") queueIds.push(one.id);

    const two = await queueChurchSms(base);
    expect(two.ok).toBe(false);
    // Marked, so the composer keeps the id and a third press is refused too.
    if (two.ok === false) expect(two.duplicate).toBe(true);

    const rows = await db
      .select({ id: scheduledSms.id })
      .from(scheduledSms)
      .where(eq(scheduledSms.requestId, requestId));
    expect(rows).toHaveLength(1);
  });
});
