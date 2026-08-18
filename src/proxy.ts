import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Lightweight optimistic check: if there's no session cookie, bounce to /login.
// Full validation happens in server components via requireChurch().
export default function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/attendance/:path*",
    "/analytics/:path*",
    "/branches/:path*",
    "/members/:path*",
    "/settings/:path*",
    "/help/:path*",
    "/my-events/:path*",
    "/onboarding/:path*",
    "/suspended",
    "/superadmin/:path*",
  ],
};
