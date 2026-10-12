/**
 * Pacing and retrying for outgoing email. Pure (no server-only, no I/O of its
 * own) so the rules can be unit-tested with fake timers.
 *
 * WHY THIS EXISTS. A church email to 400 members, and a superadmin broadcast to
 * every user, were each a single `Promise.allSettled(list.map(send))`: every
 * request opened at the same instant from one Node process. Resend answered
 * most of them with 429 "You can only make 10 requests per second", the mailer
 * logged it and moved on, and those members simply never got the message.
 * ZeptoMail has limits of its own, and thousands of simultaneous sockets is
 * also exactly the shape of load that exhausted kernel TCP memory on this VPS
 * before. So: a ceiling on how many are in flight, a ceiling on how many start
 * per second, and a retry for the failures that are worth retrying.
 *
 * TWO LANES. One pacer serves every caller in the process, so a broadcast to
 * 1,500 people queued in front of a password-reset email would make that
 * person wait minutes for it. Bulk sends say so and go in the slow lane; every
 * other send overtakes them at the next free slot.
 */

export type Lane = "now" | "bulk";

type Waiter = { start: () => void };

export class SendPacer {
  private readonly maxInFlight: number;
  private readonly perSecond: number;
  private readonly now: () => number;
  private inFlight = 0;
  private starts: number[] = [];
  private queues: Record<Lane, Waiter[]> = { now: [], bulk: [] };
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: { maxInFlight: number; perSecond: number; now?: () => number }) {
    this.maxInFlight = Math.max(1, Math.floor(opts.maxInFlight));
    this.perSecond = Math.max(1, Math.floor(opts.perSecond));
    this.now = opts.now ?? (() => Date.now());
  }

  /** Run `fn` when a slot is free. Resolves or rejects exactly as `fn` does. */
  run<T>(lane: Lane, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queues[lane].push({
        start: () => {
          let p: Promise<T>;
          try {
            p = fn();
          } catch (e) {
            p = Promise.reject(e);
          }
          p.then(resolve, reject).finally(() => {
            this.inFlight--;
            this.pump();
          });
        },
      });
      this.pump();
    });
  }

  /** Waiting plus running — for logs and tests. */
  get pending(): number {
    return this.queues.now.length + this.queues.bulk.length + this.inFlight;
  }

  private pump(): void {
    while (this.inFlight < this.maxInFlight) {
      const next = this.queues.now[0] ? this.queues.now : this.queues.bulk;
      if (next.length === 0) return;

      const t = this.now();
      this.starts = this.starts.filter((s) => t - s < 1000);
      if (this.starts.length >= this.perSecond) {
        // Full for this second. Wake when the oldest start leaves the window.
        if (!this.timer) {
          const wait = Math.max(1, 1000 - (t - this.starts[0]));
          this.timer = setTimeout(() => {
            this.timer = null;
            this.pump();
          }, wait);
        }
        return;
      }

      const w = next.shift()!;
      this.inFlight++;
      this.starts.push(t);
      w.start();
    }
  }
}

/** One provider call's verdict, in the terms the retry loop needs. */
export type AttemptResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: string;
      /** Worth trying again: a rate limit, a 5xx, a connection that never opened. */
      retryable: boolean;
      /** The provider's own Retry-After, in ms, when it sent one. */
      retryAfterMs?: number | null;
    };

/**
 * Try up to `attempts` times, waiting between tries.
 *
 * Exponential (0.5s, 1s, 2s...) with jitter, so a burst of 429s does not all
 * come back at the same instant and get refused together again. A provider's
 * Retry-After wins when it gave one, capped so a silly value cannot hold a
 * send for an hour. A failure that is not retryable (a 422 for a bad address,
 * a quota that is used up) returns at once: asking again cannot change it.
 */
export async function withRetry<T>(
  attempt: () => Promise<AttemptResult<T>>,
  opts: {
    attempts?: number;
    baseMs?: number;
    maxWaitMs?: number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
  } = {},
): Promise<AttemptResult<T> & { attempts: number }> {
  const max = Math.max(1, opts.attempts ?? 3);
  const base = opts.baseMs ?? 500;
  const cap = opts.maxWaitMs ?? 10_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;

  let last: AttemptResult<T> | null = null;
  for (let i = 0; i < max; i++) {
    last = await attempt();
    if (last.ok || !last.retryable || i === max - 1) return { ...last, attempts: i + 1 };
    const backoff = base * 2 ** i + Math.floor(random() * (base / 2));
    const wait = Math.min(cap, last.retryAfterMs != null ? Math.max(last.retryAfterMs, 0) : backoff);
    await sleep(wait);
  }
  // Unreachable: the loop always returns on its last pass.
  return { ...(last as AttemptResult<T>), attempts: max };
}

/** 429 and 5xx are the provider's state, not the message's: try again. */
export function isRetryableStatus(status: number | null | undefined): boolean {
  if (status == null) return false;
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * A Retry-After header, as milliseconds. It is either a number of seconds or
 * an HTTP date; anything else is ignored rather than guessed at.
 */
export function parseRetryAfter(
  header: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!header) return null;
  const v = header.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/**
 * Resend reports failures as a named error rather than a thrown one. The rate
 * limit and its own internal faults are worth a retry; a validation error, a
 * bad key or an exhausted quota will say the same thing every time.
 */
export function isRetryableResendError(e: {
  name?: string | null;
  statusCode?: number | null;
}): boolean {
  // A used-up quota comes back as a 429 too, but it will still be used up in
  // two seconds' time. Retrying only spends the backoff for nothing.
  if (e.name === "daily_quota_exceeded" || e.name === "monthly_quota_exceeded")
    return false;
  if (
    e.name === "rate_limit_exceeded" ||
    e.name === "application_error" ||
    e.name === "internal_server_error" ||
    e.name === "concurrent_idempotent_requests"
  )
    return true;
  return isRetryableStatus(e.statusCode ?? null);
}

/**
 * A network failure where the request never reached the provider, so sending
 * it again cannot deliver it twice. A timeout is deliberately NOT in this list:
 * the provider may have accepted a message whose answer we stopped waiting for,
 * and retrying that would put the same email in somebody's inbox twice. A
 * timed-out send is reported as failed, with the reason.
 */
export function isRetryableNetworkError(e: unknown): boolean {
  const code =
    (e as { code?: string })?.code ??
    (e as { cause?: { code?: string } })?.cause?.code ??
    "";
  return [
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    // Connecting timed out - nothing was sent. Unlike a reset mid-request,
    // which may have arrived, this one is safe to repeat.
    "UND_ERR_CONNECT_TIMEOUT",
  ].includes(code);
}
