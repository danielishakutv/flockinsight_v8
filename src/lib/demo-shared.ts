/**
 * The handful of demo facts the browser needs too.
 *
 * Split out of lib/demo.ts because that file is `server-only` — it reads
 * cookies and the database. The gate and the countdown are client components
 * and need the same numbers, and a second copy of "fifteen minutes" would
 * eventually disagree with the one being enforced.
 */

/** How long an unverified visitor may look around. */
export const DEMO_GRACE_MINUTES = 15;

/** How often the demonstration church is wiped and rebuilt. */
export const DEMO_RESET_HOURS = 2;
