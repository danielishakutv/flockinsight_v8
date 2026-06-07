"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The logged-out CTAs. Also used as the prerendered/SSG default and the
 * loading state while the client-only auth check resolves.
 */
export function LoggedOutButtons() {
  return (
    <>
      <Button asChild variant="ghost" className="max-sm:hidden">
        <Link href="/login">Login</Link>
      </Button>
      <Button asChild>
        <Link href="/signup">Get Started</Link>
      </Button>
    </>
  );
}

/**
 * The session-reading button is loaded client-only (`ssr: false`). This keeps
 * the landing page fully static (prerendered, instant from cache) — Better
 * Auth's `useSession` hook can't run during static prerendering, so we never
 * render it on the server. SSG ships the logged-out CTAs; the browser then
 * swaps in the Dashboard link for signed-in visitors.
 */
const AuthAwareButtons = dynamic(
  () =>
    import("./landing-header-auth-inner").then((m) => m.LandingHeaderAuthInner),
  { ssr: false, loading: () => <LoggedOutButtons /> },
);

export function LandingHeaderAuth() {
  return <AuthAwareButtons />;
}
