import type { RecipientOutcome } from "@/lib/comm-recipients";

/** What the mailer reports for one address (see sendEmailWithId). */
export type EmailVerdict = { ok: boolean; id: string | null; error?: string };

/**
 * Turn the settled results of a bulk email into per-recipient outcomes.
 *
 * `results[i]` must belong to `list[i]`.
 *
 * THE TRAP THIS EXISTS FOR. `sendEmailWithId` resolves to an OBJECT -
 * `{ ok: false, id: null }` when the provider refuses - and the church composer
 * tested `x.status === "fulfilled" && x.value`. An object is always truthy, so
 * every rate-limited or refused address was recorded as "sent", counted
 * against the church's email allowance, and reported as "Emailed 400 of 400".
 * `.ok === true` is the only test, and the provider's id is kept so a delivery
 * or bounce report can find this person later.
 */
export function emailOutcomesFrom(
  list: readonly { memberId: string | null; name: string | null; email: string }[],
  results: readonly PromiseSettledResult<EmailVerdict>[],
): RecipientOutcome[] {
  return list.map((r, i) => {
    const x = results[i];
    const ok = !!x && x.status === "fulfilled" && x.value.ok === true;
    let error: string | null = null;
    if (!ok) {
      if (!x) error = "Not attempted";
      else if (x.status === "rejected")
        error = String((x.reason as Error)?.message ?? x.reason).slice(0, 300);
      else error = (x.value.error || "The mail server did not accept this address").slice(0, 300);
    }
    return {
      memberId: r.memberId,
      name: r.name,
      destination: r.email,
      status: ok ? ("sent" as const) : ("failed" as const),
      error,
      providerMessageId: x && x.status === "fulfilled" ? x.value.id : null,
    };
  });
}
