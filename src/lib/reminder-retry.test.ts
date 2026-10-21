import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SMS_INTERRUPTED_DETAIL } from "@/lib/celebration-runs";
import {
  REMINDER_SMS_MAX_ATTEMPTS,
  RETRY_AFTER_MS,
  SEND_WINDOW_MIN,
  SWEEP_SLACK_MS,
  attemptLabel,
  classifyBatchSms,
  classifySingleSms,
  historyDetail,
  localDateIn,
  pledgeReminderRetry,
  serviceReminderRetry,
  willRetryAfter,
  type SmsRunState,
  type SmsVerdict,
} from "@/lib/reminder-retry";

/**
 * The rule that decides whether a reminder text is sent again. Getting it
 * wrong in one direction texts a whole congregation twice; in the other, a
 * reminder refused at 8 for an empty wallet is lost even though somebody
 * topped up at 8:15. Every case here is one of those two.
 */

const LAGOS = "Africa/Lagos"; // UTC+1, no DST
const MAPUTO = "Africa/Maputo"; // UTC+2, no DST

/** A Lagos wall-clock instant on Sunday 25 October 2026 (or another date). */
const lagos = (hhmm: string, date = "2026-10-25") => new Date(`${date}T${hhmm}:00+01:00`);
const minsBefore = (at: Date, m: number) => new Date(at.getTime() - m * 60_000);

const failed = (updatedAt: Date, attempts = 1): SmsRunState => ({
  smsOutcome: "failed",
  smsAttempts: attempts,
  updatedAt,
});

function service(
  now: Date,
  run: SmsRunState,
  over: Partial<Parameters<typeof serviceReminderRetry>[0]> = {},
) {
  return serviceReminderRetry({
    run,
    now,
    timeZone: LAGOS,
    serviceDate: "2026-10-25",
    startTime: "11:00",
    sendTime: "08:00",
    dayBefore: false,
    ...over,
  });
}

const batchOk = (o: Partial<{ sent: number; failed: number; unconfirmed: number; skipped: number }>) => ({
  ok: true as const,
  sent: 0,
  failed: 0,
  unconfirmed: 0,
  skipped: 0,
  cost: 0,
  pages: 0,
  balance: 100,
  outcomes: Array.from({ length: o.failed ?? 0 }, (_, i) => ({
    phone: `0800000000${i}`,
    status: "failed" as const,
    error: "Insufficient float",
  })),
  ...o,
});

const retryable = (v: SmsVerdict) => v.outcome === "failed" && v.retryable;
const final = (v: SmsVerdict) => v.outcome === "failed" && !v.retryable;

describe("classifyBatchSms (service reminders)", () => {
  it("retries a refusal the church can clear within the hour", () => {
    expect(
      retryable(
        classifyBatchSms({
          ok: false,
          error: "Not enough SMS balance. This needs 40.00 but your balance is 3.00.",
        }),
      ),
    ).toBe(true);
    expect(
      retryable(
        classifyBatchSms({
          ok: false,
          error: "Your SMS sender ID isn't approved yet. Apply in Settings → SMS.",
        }),
      ),
    ).toBe(true);
  });

  it("never retries a refusal that will say the same thing in an hour", () => {
    for (const error of [
      "SMS isn't available in your country yet, so nothing was sent or charged.",
      "No valid phone numbers to send to.",
      "Networks only deliver SMS between 8am – 8pm, so this can't be sent by text right now.",
      "SMS isn't enabled on the platform yet.",
    ])
      expect(final(classifyBatchSms({ ok: false, error })), error).toBe(true);
    expect(
      final(classifyBatchSms({ ok: false, error: "Not enough SMS balance.", duplicate: true })),
    ).toBe(true);
  });

  it("retries a batch the gateway turned every number away from (refunded)", () => {
    expect(retryable(classifyBatchSms(batchOk({ failed: 3 })))).toBe(true);
  });

  it("never retries a batch whose every refusal names the number", () => {
    const dnd = {
      ...batchOk({ failed: 1 }),
      outcomes: [{ phone: "08000000000", status: "failed" as const, error: "SMS not sent: DND active on number" }],
    };
    expect(final(classifyBatchSms(dnd))).toBe(true);
    // One refusal about the moment is enough to make it worth another try.
    const mixed = {
      ...batchOk({ failed: 2 }),
      outcomes: [
        { phone: "08000000000", status: "failed" as const, error: "SMS not sent: DND active on number" },
        { phone: "08000000001", status: "failed" as const, error: "SMS not sent: Insufficient balance" },
      ],
    };
    expect(retryable(classifyBatchSms(mixed))).toBe(true);
  });

  it("treats unconfirmed messages as gone, never retried", () => {
    expect(classifyBatchSms(batchOk({ unconfirmed: 2 })).outcome).toBe("sent");
  });

  it("calls a partial success sent, and names how many did not go", () => {
    const v = classifyBatchSms(batchOk({ sent: 5, failed: 2 }));
    expect(v.outcome).toBe("sent");
    expect(v.detail).toContain("2 of 7");
  });

  it("never retries a send that threw: some may have gone", () => {
    expect(final(classifyBatchSms({ threw: new Error("boom") }))).toBe(true);
  });

  it("leaves a queued batch to the queue", () => {
    const v = classifyBatchSms({
      ok: "queued",
      id: "q",
      sendAfter: new Date(),
      count: 3,
      notice: "Queued for 8am.",
      sendingNow: false,
    });
    expect(v).toEqual({ outcome: "queued", detail: "Queued for 8am." });
  });
});

describe("classifySingleSms (pledge reminders)", () => {
  it("never retries an uncertain send: it may have gone", () => {
    expect(final(classifySingleSms({ ok: false, error: "Timed out", uncertain: true }))).toBe(true);
  });

  it("retries a connection that never opened, and a plain gateway refusal", () => {
    expect(retryable(classifySingleSms({ ok: false, error: "Could not reach the SMS gateway." }))).toBe(true);
    expect(retryable(classifySingleSms({ ok: false, error: "SMS not sent: gateway error 503" }))).toBe(true);
  });

  it("never retries a refusal that names the number", () => {
    expect(final(classifySingleSms({ ok: false, error: "SMS not sent: Invalid phone number" }))).toBe(true);
    expect(final(classifySingleSms({ ok: false, error: "SMS not sent: DND active" }))).toBe(true);
  });

  it("never retries what no hour will fix", () => {
    expect(final(classifySingleSms({ ok: false, error: "No valid phone number to send to." }))).toBe(true);
    expect(final(classifySingleSms({ ok: false, error: "Message is empty." }))).toBe(true);
  });

  it("retries an empty wallet", () => {
    expect(
      retryable(classifySingleSms({ ok: false, error: "Not enough SMS balance. This needs 4.00 but your balance is 0.00." })),
    ).toBe(true);
  });

  it("reads success and queued as they are", () => {
    expect(classifySingleSms({ ok: true, cost: 4, balance: 10 }).outcome).toBe("sent");
    expect(final(classifySingleSms({ threw: new Error("x") }))).toBe(true);
  });
});

describe("serviceReminderRetry", () => {
  const now = lagos("09:00");

  it("leaves rows that are not a failed text", () => {
    for (const smsOutcome of [null, "skipped", "sent", "queued"])
      expect(service(now, { smsOutcome, smsAttempts: 1, updatedAt: minsBefore(now, 120) })).toEqual({
        action: "leave",
      });
    expect(service(now, failed(minsBefore(now, 120), 3))).toEqual({ action: "leave" });
  });

  it("waits an hour between attempts", () => {
    expect(service(now, failed(minsBefore(now, 54)))).toEqual({ action: "leave" });
    expect(service(now, failed(minsBefore(now, 56), 1))).toEqual({ action: "retry", attempt: 2 });
    expect(service(now, failed(minsBefore(now, 56), 2))).toEqual({ action: "retry", attempt: 3 });
  });

  it("leaves a fresh claim and settles a dead one without sending", () => {
    const pending = (m: number): SmsRunState => ({
      smsOutcome: "pending",
      smsAttempts: 1,
      updatedAt: minsBefore(now, m),
    });
    expect(service(now, pending(10))).toEqual({ action: "leave" });
    expect(service(now, pending(31))).toEqual({ action: "abandon", detail: SMS_INTERRUPTED_DETAIL });
  });

  it("never retries after 8pm", () => {
    const late = lagos("20:05");
    expect(service(late, failed(minsBefore(late, 120)), { sendTime: "18:00", startTime: null }).action).toBe(
      "expire",
    );
  });

  it("stops 30 minutes before the start", () => {
    const at = lagos("09:40");
    expect(service(at, failed(minsBefore(at, 90)), { startTime: "10:00" }).action).toBe("expire");
    expect(service(now, failed(minsBefore(now, 90)), { startTime: "10:00" }).action).toBe("retry");
  });

  it("has no start rule when the service has no start time", () => {
    const at = lagos("10:50");
    expect(service(at, failed(minsBefore(at, 90)), { startTime: null, sendTime: "08:30" }).action).toBe("retry");
  });

  it("never retries for a service that has already happened", () => {
    expect(service(now, failed(minsBefore(now, 90)), { serviceDate: "2026-10-24" }).action).toBe("expire");
  });

  it("retries a day-before reminder the evening before", () => {
    const at = lagos("19:30");
    expect(
      service(at, failed(minsBefore(at, 60)), {
        serviceDate: "2026-10-26",
        sendTime: "18:00",
        dayBefore: true,
      }).action,
    ).toBe("retry");
  });

  it("never retries a day-before reminder on the service morning", () => {
    expect(
      service(now, failed(minsBefore(now, 120)), { sendTime: "07:00", dayBefore: true }).action,
    ).toBe("expire");
  });

  it("waits for 8am when the window has not opened yet", () => {
    const early = lagos("07:30");
    expect(service(early, failed(minsBefore(early, 60)), { sendTime: "07:00" })).toEqual({ action: "leave" });
  });

  it("stops once the send window has closed", () => {
    const at = lagos("10:40"); // 160 minutes after 08:00
    expect(service(at, failed(minsBefore(at, 60)), { startTime: "18:00" }).action).toBe("expire");
  });

  it("reads the hours where the church is, not where the server is", () => {
    // 18:30 UTC: 19:30 in Lagos, 20:30 in Maputo.
    const at = new Date("2026-10-25T18:30:00Z");
    const over = { sendTime: "18:00", startTime: null, dayBefore: true, serviceDate: "2026-10-26" };
    expect(service(at, failed(minsBefore(at, 60)), over).action).toBe("retry");
    expect(service(at, failed(minsBefore(at, 60)), { ...over, timeZone: MAPUTO }).action).toBe("expire");
  });
});

describe("pledgeReminderRetry", () => {
  const now = lagos("09:00");
  const run = failed(minsBefore(now, 120));

  it("retries on the church-local day of the first attempt", () => {
    // 23:30 UTC on the 24th is 00:30 on the 25th in Lagos.
    expect(
      pledgeReminderRetry({ run, now, timeZone: LAGOS, claimedAt: new Date("2026-10-24T23:30:00Z") }),
    ).toEqual({ action: "retry", attempt: 2 });
  });

  it("never carries a retry into the next day", () => {
    expect(
      pledgeReminderRetry({ run, now, timeZone: LAGOS, claimedAt: lagos("08:00", "2026-10-24") }).action,
    ).toBe("expire");
    const late = lagos("20:10");
    expect(
      pledgeReminderRetry({ run: failed(minsBefore(late, 120)), now: late, timeZone: LAGOS, claimedAt: lagos("08:00") })
        .action,
    ).toBe("expire");
  });

  it("waits for 8am", () => {
    const early = lagos("07:30");
    expect(
      pledgeReminderRetry({ run: failed(minsBefore(early, 120)), now: early, timeZone: LAGOS, claimedAt: lagos("01:00") }),
    ).toEqual({ action: "leave" });
  });
});

describe("willRetryAfter: what History and the managers are told", () => {
  const refused: SmsVerdict = { outcome: "failed", detail: "Not enough SMS balance.", retryable: true };
  const decideFor = (o: { sendTime: string; serviceDate?: string; dayBefore?: boolean }) =>
    (run: SmsRunState, at: Date) =>
      serviceReminderRetry({
        run,
        now: at,
        timeZone: LAGOS,
        serviceDate: o.serviceDate ?? "2026-10-25",
        startTime: null,
        sendTime: o.sendTime,
        dayBefore: o.dayBefore ?? false,
      });

  it("does not promise a retry the 8pm cut-off will refuse", () => {
    const decide = decideFor({ sendTime: "18:00", serviceDate: "2026-10-26", dayBefore: true });
    expect(willRetryAfter(decide, refused, 1, lagos("19:10"))).toBe(false);
  });

  it("does not promise a retry past the send window", () => {
    expect(willRetryAfter(decideFor({ sendTime: "08:00" }), refused, 1, lagos("09:40"))).toBe(false);
  });

  it("promises one that will happen", () => {
    expect(willRetryAfter(decideFor({ sendTime: "08:00" }), refused, 1, lagos("08:05"))).toBe(true);
  });

  it("never for a final failure, a success, or the last attempt", () => {
    const decide = decideFor({ sendTime: "08:00" });
    expect(willRetryAfter(decide, { ...refused, retryable: false }, 1, lagos("08:05"))).toBe(false);
    expect(willRetryAfter(decide, { outcome: "sent", detail: null }, 1, lagos("08:05"))).toBe(false);
    expect(willRetryAfter(decide, refused, REMINDER_SMS_MAX_ATTEMPTS, lagos("08:05"))).toBe(false);
  });
});

describe("the attempt budget", () => {
  it("fits all three attempts inside the send window", () => {
    expect(REMINDER_SMS_MAX_ATTEMPTS).toBe(3);
    expect((2 * (RETRY_AFTER_MS + SWEEP_SLACK_MS)) / 60_000).toBeLessThanOrEqual(SEND_WINDOW_MIN);
  });

  it("matches the CHECK constraint in schema.ts", () => {
    const schema = readFileSync(join(import.meta.dirname, "..", "db", "schema.ts"), "utf8");
    for (const name of ["reminder_run_sms_attempts_chk", "pledge_reminder_run_sms_attempts_chk"])
      expect(schema, name).toMatch(
        new RegExp(`"${name}",\\s*sql\`\\$\\{t\\.smsAttempts\\} between 0 and ${REMINDER_SMS_MAX_ATTEMPTS}\``),
      );
  });
});

describe("the strings the classifier matches", () => {
  /*
   * The classifier recognises a refusal by its wording. If church-sms.ts or
   * the gateway classifier rewords one, a retry would go silent or, worse, a
   * final failure would become retryable. This fails first instead.
   */
  it("still appear in the senders", () => {
    const churchSms = readFileSync(join(import.meta.dirname, "church-sms.ts"), "utf8");
    for (const s of ["Not enough SMS balance", "sender ID isn't approved", "Networks only deliver SMS between"])
      expect(churchSms, s).toContain(s);
    const gateway = readFileSync(join(import.meta.dirname, "sms-gateway-outcome.ts"), "utf8");
    for (const s of ["Could not reach the SMS gateway.", "SMS not sent: "]) expect(gateway, s).toContain(s);
  });
});

describe("wording", () => {
  it("labels retries in History", () => {
    expect(attemptLabel("Reminder: X", 1)).toBe("Reminder: X");
    expect(attemptLabel("Reminder: X", 2)).toBe("Reminder: X (attempt 2 of 3)");
  });

  it("says whether to leave it alone", () => {
    const v: SmsVerdict = { outcome: "failed", detail: "No balance.", retryable: true };
    expect(historyDetail(v, true)).toContain("do not send it again by hand");
    expect(historyDetail(v, false)).toContain("will not be tried again");
  });

  it("falls back to Lagos for a timezone Intl refuses", () => {
    expect(localDateIn(new Date("2026-10-24T23:30:00Z"), "Not/AZone")).toBe("2026-10-25");
  });
});

describe("the migration", () => {
  /*
   * The new columns were generated into a shared migration with other
   * features, so it is found by what it does rather than by its number.
   * Everything it does to these two tables must be additive: no UPDATE, no
   * DROP, no type change on a table that already holds production rows.
   */
  it("only adds to reminder_run and pledge_reminder_run", () => {
    const dir = join(import.meta.dirname, "..", "db", "migrations");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) =>
        readFileSync(join(dir, f), "utf8").includes(`ALTER TABLE "reminder_run" ADD COLUMN "sms_outcome"`),
      );
    expect(files).toHaveLength(1);
    const statements = readFileSync(join(dir, files[0]), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => /"(pledge_)?reminder_run"/.test(s));
    expect(statements.length).toBeGreaterThanOrEqual(15);
    for (const s of statements) {
      expect(s).toMatch(/^(ALTER TABLE "(pledge_)?reminder_run" ADD (COLUMN|CONSTRAINT)|CREATE INDEX)/);
      expect(s).not.toMatch(/\b(UPDATE|DROP|ALTER COLUMN)\b/i);
    }
  });
});
