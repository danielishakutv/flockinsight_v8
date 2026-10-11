import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { partner } from "@/db/schema";
import {
  PARTNER_COOKIE,
  PARTNER_TTL_SECONDS,
} from "@/lib/partner-link";
import { normalisePartnerCode } from "@/lib/partners-shared";

/**
 * A Partner's referral link: /a/<their-code>.
 *
 * The same shape as a church's /r/<handle>, and for the same two reasons: a
 * search param on the landing page would make it render per request and undo
 * the caching that keeps it quick on a slow connection, and only a route
 * handler can set a cookie — which is what lets the attribution survive a
 * pastor reading the pricing page before signing up.
 *
 * "a" for agent, and one letter because this gets read down a phone line and
 * written on the back of a card.
 *
 * The code is checked against a real Partner before anything is stored, so a
 * made-up link cannot plant a credit for somebody who does not exist. A
 * SUSPENDED Partner still captures the attribution: whether they get paid is a
 * separate question, answered when the church actually pays, and losing the
 * record of who brought a church would make that question unanswerable.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: raw } = await params;
  const code = normalisePartnerCode(raw);

  const home = new URL("/", process.env.BETTER_AUTH_URL || "https://flockinsight.com");
  if (!code) return NextResponse.redirect(home, { status: 307 });

  const [found] = await db
    .select({ code: partner.code })
    .from(partner)
    .where(eq(partner.code, code))
    .limit(1);

  const res = NextResponse.redirect(home, { status: 307 });
  if (!found) return res;

  res.cookies.set(PARTNER_COOKIE, found.code, {
    maxAge: PARTNER_TTL_SECONDS,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
