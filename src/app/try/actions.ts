"use server";

import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { staff, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getDemoChurch, startDemoVisit } from "@/lib/demo";
import { checkDemoContact } from "@/lib/demo-shared";
import { getSession } from "@/lib/session";

export type EnterDemoResult = { ok: true } | { ok: false; error: string };

const CLOSED =
  "The live demo is closed for maintenance just now. Book a walkthrough instead and we'll show you round.";

/**
 * Walk straight into the demo church, without knowing its password.
 *
 * The demo used to be a published email and password, then a form. Now the
 * form comes first and the server signs the visitor in as the shared demo
 * account itself, from DEMO_LOGIN_EMAIL / DEMO_LOGIN_PASSWORD in the server's
 * .env. The password never reaches the browser, so the only way in is through
 * the form — which is what makes the email and phone worth asking for.
 *
 * That makes this the most dangerous action on the public site if the env
 * ever names the wrong account: it would hand that account to anybody who
 * types an email address. So before signing anybody in it proves, from the
 * database, that the account is not a platform operator and belongs to the
 * demonstration church and no other church at all. Any doubt closes the door
 * and says so in the log; it never falls back to letting them in.
 */
export async function enterDemo(input: {
  email: string;
  phone: string;
  country: string;
  name?: string;
  /** Honeypot: real people never see it. */
  website?: string;
}): Promise<EnterDemoResult> {
  // A bot that fills every box gets the same answer as a person and nothing else.
  if (input.website && input.website.trim() !== "") {
    console.warn(`[demo] honeypot filled, visit refused: ${input.email} / ${input.phone}`);
    return { ok: true };
  }

  const contact = checkDemoContact(input);
  if (!contact.ok) return contact;

  const demo = await getDemoChurch();
  if (!demo) return { ok: false, error: CLOSED };

  const loginEmail = process.env.DEMO_LOGIN_EMAIL?.trim().toLowerCase();
  const loginPassword = process.env.DEMO_LOGIN_PASSWORD;
  if (!loginEmail || !loginPassword) {
    console.error("[demo] DEMO_LOGIN_EMAIL / DEMO_LOGIN_PASSWORD are not set — the one-click demo is closed");
    return { ok: false, error: CLOSED };
  }

  const [account] = await db
    .select({ id: user.id, isSuperAdmin: user.isSuperAdmin })
    .from(user)
    .where(eq(user.email, loginEmail))
    .limit(1);
  if (!account) {
    console.error(`[demo] DEMO_LOGIN_EMAIL names no account (${loginEmail}) — the one-click demo is closed`);
    return { ok: false, error: CLOSED };
  }
  if (account.isSuperAdmin) {
    console.error("[demo] DEMO_LOGIN_EMAIL is a superadmin — refusing to hand it to the public");
    return { ok: false, error: CLOSED };
  }
  const churches = await db
    .select({ churchId: staff.organizationId })
    .from(staff)
    .where(and(eq(staff.userId, account.id), eq(staff.temp, false)));
  if (churches.length === 0 || churches.some((c) => c.churchId !== demo.id)) {
    console.error(
      `[demo] DEMO_LOGIN_EMAIL belongs to ${churches.length} church(es), not only the demo church — refusing`,
    );
    return { ok: false, error: CLOSED };
  }

  /*
   * Somebody already signed in. As the demo account, they only need a visit
   * of their own. As anybody else, signing them in as the demo would silently
   * swap them out of their own church — so say so, and let them choose.
   */
  const current = await getSession();
  const alreadyDemo = current?.user?.id === account.id;
  if (current?.user && !alreadyDemo)
    return {
      ok: false,
      error: `You're signed in as ${current.user.email}. Sign out first to open the demo.`,
    };

  // Rate-limited per address inside; records the lead and sets the visit cookie.
  const visit = await startDemoVisit({
    churchId: demo.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    country: contact.country,
  });
  if (!visit.ok) return visit;

  if (!alreadyDemo) {
    try {
      // nextCookies() in lib/auth.ts writes the session cookie from here.
      await auth.api.signInEmail({
        body: { email: loginEmail, password: loginPassword },
        headers: await headers(),
      });
    } catch (e) {
      // Almost always the password in .env no longer matching the account —
      // somebody changed it from /profile. Loud, because nobody can get in.
      console.error("[demo] signing in as the demo account failed", e);
      return { ok: false, error: CLOSED };
    }
  }

  return { ok: true };
}
