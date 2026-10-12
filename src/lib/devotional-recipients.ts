import { normalizeEmail } from "@/lib/email-address";

/**
 * How an opt-out is matched to an address. Pure, so the rule is tested.
 *
 * Both sides go through the same normalising - an opt-out stored as
 * "Ada@Example.com" must still stop mail to "ada@example.com " on a member
 * record, or the person who said stop keeps hearing from us.
 */
export function optOutKey(email: string | null | undefined): string {
  return normalizeEmail(email) ?? (email ?? "").trim().toLowerCase();
}

export function isOptedOut(optedOut: ReadonlySet<string>, email: string): boolean {
  return optedOut.has(optOutKey(email));
}
