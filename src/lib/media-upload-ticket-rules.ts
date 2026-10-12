/**
 * Whether a church may be handed another direct-upload ticket — the decision,
 * without the database, so it can be tested exactly. The facts are looked up
 * by lib/media-upload-tickets.ts under the church's quota lock.
 *
 * Kept free of `server-only` and of anything that reaches a connection.
 */
import { formatBytes } from "@/lib/storage-bytes";

/** How long Cloudinary honours an upload signature. */
export const TICKET_TTL_MS = 60 * 60_000;

/**
 * Open tickets a church may hold at once.
 *
 * The bound that reserving the declared size cannot give on its own: the size
 * is the browser's word, so `{bytes: 1}` reserves next to nothing and could be
 * asked for again and again, each ticket good for a 100 MB asset. A person
 * uploading a batch of large files by hand does not need more than this in
 * flight; the queue in the browser sends them a few at a time.
 */
export const MAX_OPEN_TICKETS = 6;

/**
 * How long after a ticket's signature stops working its asset is destroyed if
 * nobody completed it. Generous: a chunked upload that began just before
 * expiry may still be finishing, and /complete may be retried after a lost
 * answer.
 */
export const REAP_AFTER_EXPIRY_MS = 2 * 60 * 60_000;

export type TicketFacts = {
  /** Bytes the church's media rows already count. */
  used: number;
  limit: number;
  /** Declared bytes of the church's open, unexpired tickets. */
  reservedBytes: number;
  openTickets: number;
  /** What this upload says it is. */
  bytes: number;
};

export type TicketVerdict =
  | { ok: true }
  | { ok: false; status: number; code: "busy" | "quota"; error: string };

export function uploadTicketVerdict(f: TicketFacts): TicketVerdict {
  if (f.openTickets >= MAX_OPEN_TICKETS)
    return {
      ok: false,
      status: 429,
      code: "busy",
      error: `${f.openTickets} uploads are already in progress for this church. Let one finish, then try this one again.`,
    };
  /*
   * Uploads already in flight count, or two tabs each starting a 90 MB file
   * with 100 MB free would both be told yes — and the first anyone would hear
   * of it is the second one being thrown away at /complete after ten minutes.
   */
  const free = Math.max(0, f.limit - f.used - f.reservedBytes);
  if (f.used + f.reservedBytes + f.bytes > f.limit)
    return {
      ok: false,
      status: 413,
      code: "quota",
      error:
        f.reservedBytes > 0
          ? `Not enough storage — this file is ${formatBytes(f.bytes)}, and with ${formatBytes(f.reservedBytes)} of uploads already in progress you have ${formatBytes(free)} free. Let those finish, free up space, or upgrade your storage.`
          : `Not enough storage — this file is ${formatBytes(f.bytes)} and you have ${formatBytes(free)} free. Free up space or upgrade your storage.`,
    };
  return { ok: true };
}
