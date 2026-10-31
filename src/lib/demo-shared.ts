import { dialCountry } from "@/lib/dial-codes";
import { internationalPhone } from "@/lib/phone-intl";

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


export type DemoContact =
  | { ok: true; email: string; phone: string; country: string; name: string | null }
  | { ok: false; error: string };

/**
 * The details a visitor gives to get into the demo, checked the same way in
 * the browser and on the server.
 *
 * Email and phone are both required, and the phone is always stored with its
 * country code: a lead whose number cannot be dialled from Lagos is a lead
 * nobody can follow up. The name is optional on purpose — it is the one field
 * people hesitate over, and the least useful of the three.
 */
export function checkDemoContact(input: {
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  name?: string | null;
}): DemoContact {
  const email = (input.email ?? "").trim().toLowerCase();
  if (!email) return { ok: false, error: "Enter your email address." };
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, error: "That email address doesn't look right." };

  const place = dialCountry(input.country);
  if (!place) return { ok: false, error: "Choose your country." };

  const typed = (input.phone ?? "").trim();
  if (!typed) return { ok: false, error: "Enter your phone number." };
  const digits = internationalPhone(typed, place.dial);
  if (!digits)
    return {
      ok: false,
      error: `That isn't a complete ${place.name} phone number (+${place.dial}).`,
    };

  const name = (input.name ?? "").trim().slice(0, 120) || null;
  return { ok: true, email, phone: `+${digits}`, country: place.name, name };
}
