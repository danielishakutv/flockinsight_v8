/**
 * Database-backed checks for notification delivery receipts. `pnpm test:db`.
 *
 * Webhooks arrive out of order, twice, and sometimes for mail this app never
 * sent. None of that is visible by reading the code, and every one of them
 * ends the same way if it is wrong: a bounce that is never noticed, because
 * something overwrote it with "delivered".
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notification, notificationReceipt } from "@/db/schema";
import { applyNotificationReport } from "@/lib/delivery-reports";

const stamp = Date.now();
const TITLE = `ZZ receipts ${stamp}`;
const EMAIL = `zz-receipt-${stamp}@example.com`;
const MSG_ID = `zz-msg-${stamp}`;

let notificationId: string;

async function seed(over: Partial<{ providerMessageId: string | null; status: "sent" | "delivered" | "undelivered" }> = {}) {
  await db.delete(notificationReceipt).where(eq(notificationReceipt.email, EMAIL));
  await db.insert(notificationReceipt).values({
    notificationId,
    email: EMAIL,
    name: "ZZ Tester",
    status: over.status ?? "sent",
    providerMessageId:
      over.providerMessageId === undefined ? MSG_ID : over.providerMessageId,
  });
}

async function statusOf(): Promise<string> {
  const [r] = await db
    .select({ status: notificationReceipt.status })
    .from(notificationReceipt)
    .where(eq(notificationReceipt.email, EMAIL))
    .limit(1);
  return r?.status ?? "missing";
}

beforeEach(async () => {
  if (!notificationId) {
    const [n] = await db
      .insert(notification)
      .values({ title: TITLE, body: "body", inApp: false })
      .returning({ id: notification.id });
    notificationId = n.id;
  }
});

afterAll(async () => {
  await db.delete(notificationReceipt).where(eq(notificationReceipt.email, EMAIL));
  if (notificationId) {
    await db.delete(notification).where(inArray(notification.id, [notificationId]));
  }
});

describe("applyNotificationReport", () => {
  it("marks a receipt delivered when matched on the provider's id", async () => {
    await seed();
    const res = await applyNotificationReport({
      providerMessageId: MSG_ID,
      state: "delivered",
    });
    expect(res).toBe("updated");
    expect(await statusOf()).toBe("delivered");
  });

  it("falls back to the address when the id is unknown", async () => {
    // ZeptoMail does not always echo the request id back on a bounce.
    await seed({ providerMessageId: null });
    const res = await applyNotificationReport({
      providerMessageId: null,
      destination: EMAIL,
      state: "undelivered",
      reason: "Bounced — 550 user unknown",
    });
    expect(res).toBe("updated");
    expect(await statusOf()).toBe("undelivered");
  });

  it("records why it bounced, not just that it did", async () => {
    await seed();
    await applyNotificationReport({
      providerMessageId: MSG_ID,
      state: "undelivered",
      reason: "Bounced — 550 user unknown",
    });
    const [r] = await db
      .select({ error: notificationReceipt.error })
      .from(notificationReceipt)
      .where(eq(notificationReceipt.email, EMAIL))
      .limit(1);
    expect(r.error).toContain("550");
  });

  it("never drags a finished row back to 'sent'", async () => {
    // A "Message Sent" event landing after "DELIVERED" must not undo it.
    await seed({ status: "delivered" });
    const res = await applyNotificationReport({
      providerMessageId: MSG_ID,
      state: "sent",
    });
    expect(res).toBe("unchanged");
    expect(await statusOf()).toBe("delivered");
  });

  it("lets a bounce land after a delivery, because that really happens", async () => {
    // Deliberate, and shared with the SMS log: between the two final states
    // the newer report wins, since a message can be accepted and bounce
    // afterwards. The cost is that a replayed old "delivered" would bury a
    // bounce — see shouldApply in delivery-status.ts.
    await seed({ status: "delivered" });
    const res = await applyNotificationReport({
      providerMessageId: MSG_ID,
      state: "undelivered",
      reason: "Bounced — mailbox full",
    });
    expect(res).toBe("updated");
    expect(await statusOf()).toBe("undelivered");
  });

  it("settles on the same answer however many times a report repeats", async () => {
    await seed();
    for (let i = 0; i < 3; i++) {
      await applyNotificationReport({ providerMessageId: MSG_ID, state: "delivered" });
    }
    expect(await statusOf()).toBe("delivered");
    const rows = await db
      .select({ id: notificationReceipt.id })
      .from(notificationReceipt)
      .where(eq(notificationReceipt.email, EMAIL));
    // A repeat must never create a second row for the same recipient.
    expect(rows).toHaveLength(1);
  });

  it("reports no match for mail this app never sent", async () => {
    // The same provider account is used elsewhere; its reports must not touch
    // anything here.
    const res = await applyNotificationReport({
      providerMessageId: `not-ours-${stamp}`,
      destination: `stranger-${stamp}@example.com`,
      state: "delivered",
    });
    expect(res).toBe("unmatched");
  });

  it("fills in the provider id when it matched by address", async () => {
    // So the next report for the same message goes straight to this row.
    await seed({ providerMessageId: null });
    await applyNotificationReport({
      providerMessageId: MSG_ID,
      destination: EMAIL,
      state: "delivered",
    });
    const [r] = await db
      .select({ pid: notificationReceipt.providerMessageId })
      .from(notificationReceipt)
      .where(eq(notificationReceipt.email, EMAIL))
      .limit(1);
    expect(r.pid).toBe(MSG_ID);
  });
});
