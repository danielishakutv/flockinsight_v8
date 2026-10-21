/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/**
 * Did Postgres refuse this as a duplicate — optionally on one named
 * constraint?
 *
 * WALKS THE `cause` CHAIN, and that is the whole point of the function.
 * Drizzle wraps every driver error in a `DrizzleQueryError` and keeps the real
 * one on `.cause`, inside a transaction as well as outside it. So the obvious
 * version, reading `.code` off whatever the catch was handed, matches nothing,
 * and every catch written that way was dead code: Finance answered a duplicate
 * account name with "Could not save the account." instead of saying which
 * name was taken, and onboarding a second church whose name made the same slug
 * never took its retry — it deleted the owner it had just created and failed,
 * every time, for that name.
 *
 * One shared copy, so the next catch does not write the one-level version
 * again. `links.ts` and `partners.ts` already walk the chain with copies of
 * their own, and are left as they are.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  // A bounded walk: a cycle in a cause chain would otherwise hang the request.
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth++) {
    const e = current as {
      code?: unknown;
      constraint?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (e.code === UNIQUE_VIOLATION) {
      if (!constraint) return true;
      return e.constraint === constraint || e.constraint_name === constraint;
    }
    current = e.cause;
  }
  return false;
}
