import { NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import {
  REFERRAL_COOKIE,
  REFERRAL_TTL_SECONDS,
  normaliseCode,
} from "@/lib/referral";

/**
 * A church's referral link: /r/<their-handle>.
 *
 * A route rather than `/?ref=…` on the landing page for two reasons. Reading a
 * search param in the landing page would make it render per request, undoing
 * the caching that keeps it quick on a slow connection; and only a route
 * handler can set a cookie, which is what lets the referral survive someone
 * reading the pricing page before they sign up.
 *
 * The code is checked against a real church before anything is stored, so a
 * made-up link cannot plant a credit for a church that does not exist.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: raw } = await params;
  const code = normaliseCode(raw);

  const home = new URL("/", process.env.BETTER_AUTH_URL || "https://flockinsight.com");

  if (!code) return NextResponse.redirect(home, { status: 307 });

  const [ref] = await db
    .select({ id: church.id, handle: church.handle, slug: church.slug })
    .from(church)
    .where(or(eq(church.handle, code), eq(church.slug, code)))
    .limit(1);

  const res = NextResponse.redirect(home, { status: 307 });
  if (!ref) return res;

  res.cookies.set(REFERRAL_COOKIE, ref.id, {
    maxAge: REFERRAL_TTL_SECONDS,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
