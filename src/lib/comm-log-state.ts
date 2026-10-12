/**
 * What a communication_log row's progress means to the person reading
 * History. Pure, so client and server components share it and it can be
 * tested without a database.
 *
 * A composer email is logged as "sending" before its first message goes and
 * finished as "done" after its last (see deliverEmails in
 * app/(app)/communication/actions.ts). A row that stays "sending" with no
 * progress for this long was abandoned - a deploy or a memory restart killed
 * the process between two batches - and it is shown as interrupted, with the
 * counts it reached, so nobody reads "sending" for ever and nobody sends the
 * whole thing again without knowing some of it already went.
 *
 * 15 minutes, measured from the last progress: results are written every 50
 * messages, which at the mailer's 5 a second is every 10 seconds or so, so
 * even a retry storm comes nowhere near it.
 */
export const LOG_STALLED_AFTER_MINUTES = 15;

export type LogState = "sending" | "interrupted" | "done";

export function logState(
  status: string | null | undefined,
  updatedAt: Date | string,
  now: Date = new Date(),
): LogState {
  if (status === "interrupted") return "interrupted";
  if (status !== "sending") return "done";
  const last = typeof updatedAt === "string" ? new Date(updatedAt) : updatedAt;
  return now.getTime() - last.getTime() > LOG_STALLED_AFTER_MINUTES * 60_000
    ? "interrupted"
    : "sending";
}

/** The sentence History shows for a row that is not finished. */
export function logStateNotice(
  state: LogState,
  counts: { sent: number; failed: number; recipients: number },
): string | null {
  const done = counts.sent + counts.failed;
  if (state === "sending")
    return `Still sending: ${done} of ${counts.recipients} handled so far. This page fills in as the rest go out.`;
  if (state === "interrupted")
    return `Interrupted: sending stopped after ${done} of ${counts.recipients}. The ${counts.sent} marked sent did go out; the rest may not have. Check the list below before sending it again, so nobody gets it twice.`;
  return null;
}
