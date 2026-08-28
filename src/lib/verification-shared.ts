/**
 * Pure helpers for reading a church's verification state.
 *
 * Deliberately free of `server-only` and of any DB import so a client
 * component (the dashboard banner, the superadmin table) can use exactly the
 * same rules the server does, rather than each re-deriving "verified" and
 * drifting apart.
 *
 * Dates arrive as `Date` from Drizzle but as ISO strings once a value has been
 * through a cache or a server→client boundary, so every field is typed for
 * both — see the `unstable_cache` gotcha that bit the cached dashboard pages.
 */

export type Stamp = Date | string | null | undefined;

export type VerificationFields = {
  contactEmail?: string | null;
  contactPhone?: string | null;
  emailVerifiedAt?: Stamp;
  phoneVerifiedAt?: Stamp;
};

/** Has this stamp actually been set (and is it a real date)? */
export function isStamped(v: Stamp): boolean {
  if (!v) return false;
  const d = v instanceof Date ? v : new Date(v);
  return !Number.isNaN(d.getTime());
}

export function emailVerified(c: VerificationFields): boolean {
  return !!c.contactEmail && isStamped(c.emailVerifiedAt);
}

export function phoneVerified(c: VerificationFields): boolean {
  return !!c.contactPhone && isStamped(c.phoneVerifiedAt);
}

/**
 * A church is verified once BOTH its account email and its account phone are
 * confirmed. One of the two is "partly verified" — enough to show progress,
 * not enough for a tick.
 */
export function isChurchVerified(c: VerificationFields): boolean {
  return emailVerified(c) && phoneVerified(c);
}

export type VerificationState = "verified" | "partial" | "unverified";

export function verificationState(c: VerificationFields): VerificationState {
  const e = emailVerified(c);
  const p = phoneVerified(c);
  if (e && p) return "verified";
  if (e || p) return "partial";
  return "unverified";
}

export const VERIFICATION_LABEL: Record<VerificationState, string> = {
  verified: "Verified",
  partial: "Partly verified",
  unverified: "Not verified",
};

/** What's still outstanding, phrased for a sentence: "email and phone number". */
export function missingVerificationLabel(c: VerificationFields): string {
  const missing: string[] = [];
  if (!emailVerified(c)) missing.push("email address");
  if (!phoneVerified(c)) missing.push("phone number");
  return missing.join(" and ");
}

/** `dan@example.com` → `d••@example.com`. Used when echoing a destination back. */
export function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  const head = name.slice(0, 1);
  return `${head}${"•".repeat(Math.max(2, name.length - 1))}@${domain}`;
}

/** `2348088256055` → `••• ••• 6055`. */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return `••• ••• ${d.slice(-4)}`;
}
