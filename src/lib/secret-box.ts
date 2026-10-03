import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Encryption for secrets a church hands us to hold.
 *
 * WHY THIS EXISTS. A church's payment gateway keys are not our secrets — they
 * are credentials that can move that church's money, and we are only storing
 * them so the Give button works. A database dump is a routine artefact here:
 * backups go off-site nightly, and a superadmin can export a church. In plain
 * text, any one of those files hands over every church's live payment keys.
 *
 * So the keys are encrypted with a key that is NOT in the database and NOT in
 * the backup — `PAYMENTS_ENC_KEY` in the environment. A leaked dump is then
 * useless on its own, which is the whole point.
 *
 * AES-256-GCM, because authentication matters as much as secrecy: a tampered
 * ciphertext must fail loudly rather than decrypt to something else. The IV is
 * random per value and stored with it; the tag is checked on every read.
 *
 * DELIBERATELY NOT BETTER_AUTH_SECRET. Rotating that is a normal thing to do
 * after a scare, and it must not silently make every church's gateway
 * undecryptable. Two secrets, two independent rotations.
 */

const PREFIX = "v1";

/** Base64 of 32 bytes. `openssl rand -base64 32` produces exactly this. */
function keyFromEnv(): Buffer | null {
  const raw = (process.env.PAYMENTS_ENC_KEY || "").trim();
  if (!raw) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    return null;
  }
  // A 16- or 24-byte key is valid AES but not what this promises, and a short
  // one is usually a truncated paste. Only 256-bit is accepted.
  if (buf.length !== 32) return null;
  return buf;
}

/**
 * Is the platform able to hold secrets at all?
 *
 * Every page that would offer to store one asks this first and says plainly
 * that it cannot, rather than accepting a key it would have to drop or — far
 * worse — quietly write in the clear.
 */
export function isSecretBoxReady(): boolean {
  return keyFromEnv() !== null;
}

/** The one line an operator needs when it is not configured. */
export const SECRET_BOX_SETUP_HINT =
  "Set PAYMENTS_ENC_KEY in the server environment (openssl rand -base64 32) and restart the app.";

export type SealResult =
  | { ok: true; sealed: string }
  | { ok: false; error: string };

/**
 * Encrypt a secret for storage. The result is safe to put in a column:
 * `v1.<iv>.<tag>.<ciphertext>`, all base64url.
 */
export function sealSecret(plain: string): SealResult {
  const key = keyFromEnv();
  if (!key)
    return {
      ok: false,
      error: "This server isn't set up to store payment keys yet.",
    };
  if (typeof plain !== "string" || plain.length === 0)
    return { ok: false, error: "Nothing to store." };
  // 12 bytes is the GCM standard; anything else forces a slower path and
  // weakens the uniqueness guarantee the counter relies on.
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ok: true,
    sealed: [
      PREFIX,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ct.toString("base64url"),
    ].join("."),
  };
}

/**
 * Decrypt. Returns null for anything that is not exactly what we wrote —
 * a wrong key, a truncated column, a value tampered with in the database.
 *
 * Null rather than a throw, because every caller is on a payment path and has
 * to make the same decision: treat the gateway as not configured and say so.
 * A throw there would turn a storage problem into a 500 on a public page.
 */
export function openSecret(sealed: string | null | undefined): string | null {
  const key = keyFromEnv();
  if (!key || !sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ct = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(ct), decipher.final()]);
    return out.toString("utf8");
  } catch {
    // final() throws when the tag does not verify. That is the feature.
    return null;
  }
}

/** Seal a JSON object (provider extras: a contract code, a webhook hash). */
export function sealJson(value: Record<string, string>): SealResult {
  return sealSecret(JSON.stringify(value));
}

/** Open one. Returns an empty object rather than null, so callers can index it. */
export function openJson(sealed: string | null | undefined): Record<string, string> {
  const plain = openSecret(sealed);
  if (!plain) return {};
  try {
    const parsed: unknown = JSON.parse(plain);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The last four characters of a secret, for showing which key is stored
 * without showing the key. Never the first four: a Paystack secret begins
 * `sk_live_`, which is the same for everybody and tells nobody anything.
 */
export function secretHint(plain: string | null): string | null {
  if (!plain || plain.length < 4) return null;
  return `••••${plain.slice(-4)}`;
}

/**
 * Constant-time string compare, for webhook signatures.
 *
 * `a === b` leaks where two strings first differ, which over enough attempts
 * is how a signature gets guessed one character at a time.
 */
export function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
