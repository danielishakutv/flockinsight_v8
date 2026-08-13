import "dotenv/config";
import { Pool } from "pg";
import crypto from "node:crypto";

/**
 * Diagnostic for delivery reports. Seeds a throwaway message with two
 * recipients, posts real-shaped Termii payloads at the running app, and checks
 * the recipient rows and the log's recomputed counters. Cleans up after itself.
 *
 * Needs the app running and TERMII_WEBHOOK_SECRET set.
 *   BASE=http://localhost:3002 pnpm exec tsx scripts/check-delivery-reports.ts
 */

const BASE = process.env.BASE || "http://localhost:3000";
const SECRET = process.env.TERMII_WEBHOOK_SECRET || "";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function post(path: string, body: unknown): Promise<number> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.status;
}

async function statusOf(id: string): Promise<string> {
  return (
    await pool.query("select status from communication_recipient where id = $1", [
      id,
    ])
  ).rows[0]?.status;
}

async function main() {
  if (!SECRET) {
    console.log("TERMII_WEBHOOK_SECRET is not set — cannot test the webhook.");
    process.exit(1);
  }

  const church = (await pool.query("select id from church limit 1")).rows[0];
  if (!church) {
    console.log("No church locally — nothing to check.");
    await pool.end();
    return;
  }

  console.log("Delivery reports:\n");

  const msgId = `zztest-${crypto.randomUUID()}`;
  const log = (
    await pool.query(
      `insert into communication_log
         (church_id, channel, audience, body, recipients, sent, failed, skipped)
       values ($1,'sms','ZZTest','hello',2,2,0,0) returning id`,
      [church.id],
    )
  ).rows[0];

  // One matched by provider id, one that will match on phone number only.
  const byId = (
    await pool.query(
      `insert into communication_recipient
         (log_id, church_id, name, destination, status, provider_message_id)
       values ($1,$2,'ZZ One','2348000000001','sent',$3) returning id`,
      [log.id, church.id, msgId],
    )
  ).rows[0];
  const byPhone = (
    await pool.query(
      `insert into communication_recipient
         (log_id, church_id, name, destination, status)
       values ($1,$2,'ZZ Two','2348000000002','sent') returning id`,
      [log.id, church.id],
    )
  ).rows[0];

  // --- auth ---
  check(
    "a wrong secret is rejected",
    (await post("/api/webhooks/termii?key=WRONG", {})) === 401,
  );

  // --- matched by provider message id ---
  await post(`/api/webhooks/termii?key=${SECRET}`, {
    message_id: msgId,
    receiver: "2348000000001",
    status: "DELIVERED",
  });
  check("a DELIVERED report marks that recipient delivered", (await statusOf(byId.id)) === "delivered");

  // --- matched by phone number when the id is unknown ---
  await post(`/api/webhooks/termii?key=${SECRET}`, {
    message_id: "an-id-we-never-stored",
    receiver: "2348000000002",
    status: "DND Active on Phone Number",
  });
  check(
    "an unknown id still attributes by phone number",
    (await statusOf(byPhone.id)) === "undelivered",
  );

  const reason = (
    await pool.query(
      "select error from communication_recipient where id = $1",
      [byPhone.id],
    )
  ).rows[0]?.error;
  check("DND is explained in plain words", /DND/i.test(reason ?? ""), reason);

  // --- counters recomputed ---
  const counts = (
    await pool.query(
      "select sent, failed, skipped from communication_log where id = $1",
      [log.id],
    )
  ).rows[0];
  check(
    "the log's counters are recomputed, not left stale",
    Number(counts.sent) === 1 && Number(counts.failed) === 1,
    `sent=${counts.sent} failed=${counts.failed}`,
  );

  // --- idempotent + no downgrade ---
  await post(`/api/webhooks/termii?key=${SECRET}`, {
    message_id: msgId,
    receiver: "2348000000001",
    status: "DELIVERED",
  });
  check("a replayed report changes nothing", (await statusOf(byId.id)) === "delivered");

  await post(`/api/webhooks/termii?key=${SECRET}`, {
    message_id: msgId,
    receiver: "2348000000001",
    status: "Message Sent",
  });
  check(
    "a late 'Message Sent' does not undo a delivery",
    (await statusOf(byId.id)) === "delivered",
  );

  // --- unknown status is acknowledged, not retried ---
  check(
    "an unrecognised status is acknowledged with 200",
    (await post(`/api/webhooks/termii?key=${SECRET}`, {
      message_id: msgId,
      receiver: "2348000000001",
      status: "Something Termii Added Later",
    })) === 200,
  );

  // --- a report for a message we never sent is not an error ---
  check(
    "a report for an unknown message is acknowledged",
    (await post(`/api/webhooks/termii?key=${SECRET}`, {
      message_id: "not-ours",
      receiver: "2349999999999",
      status: "DELIVERED",
    })) === 200,
  );

  await pool.query("delete from communication_log where id = $1", [log.id]);

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
