import { isRetryableNetworkError } from "@/lib/email-pacing";

/**
 * Did a gateway call that did not say "sent" definitely NOT send?
 *
 * Pure, so the rule can be tested without a gateway. The answer decides money
 * and repetition: a definite failure is refunded and may be tried again, and
 * an uncertain one must be neither.
 *
 * WHY THIS IS A THIRD OUTCOME. A timeout used to be reported as a plain
 * failure. The batch sender refunded it in full, the queue saw "nothing went,
 * nothing was charged" and sent the whole row again half an hour later - up to
 * three times. But a call we stopped waiting for has very often been accepted:
 * Termii takes a bulk send to 1,500 numbers, answers after 31 seconds, and the
 * congregation got the same 8am notice three times while the church paid for
 * none of them.
 *
 * "Definitely not sent" is only what we can prove: the connection never opened
 * (refused, no DNS, connect timeout - the same list email retries on), or the
 * gateway answered with a refusal. Everything else - a timeout after the
 * request was written, a reset mid-response, a 2xx whose body could not be
 * read - may have gone, and is reported as uncertain.
 */
export type GatewayFailure = { error: string; uncertain: boolean };

/** A call that threw before any answer arrived. */
export function classifySendThrow(e: unknown, timeoutSeconds: number): GatewayFailure {
  if (isRetryableNetworkError(e))
    return { error: "Could not reach the SMS gateway.", uncertain: false };
  const name = (e as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError")
    return {
      error: `The SMS gateway did not answer within ${timeoutSeconds} seconds, so it may still have delivered this. It was not retried, and it was not refunded; check the delivery report before sending it again.`,
      uncertain: true,
    };
  return {
    error:
      "The connection to the SMS gateway broke before it answered, so it may still have delivered this. It was not retried, and it was not refunded; check the delivery report before sending it again.",
    uncertain: true,
  };
}

/**
 * The gateway answered, but not with a recognisable success. `body` is null
 * when it could not be read (a timeout or a reset while reading it, or not
 * JSON at all).
 */
export function classifyReply(
  status: number,
  body: { message?: unknown } | null,
): GatewayFailure {
  const accepted = status >= 200 && status < 300;
  if (accepted && body == null)
    // A 2xx is the gateway taking the request. An answer we could not read
    // does not undo that.
    return {
      error: `The SMS gateway accepted this (${status}) but its answer could not be read, so it may well have gone. It was not retried, and it was not refunded; check the delivery report before sending it again.`,
      uncertain: true,
    };
  const said = body && typeof body.message === "string" && body.message.trim();
  return {
    error: `SMS not sent: ${said || `gateway error ${status}`}`,
    uncertain: false,
  };
}
