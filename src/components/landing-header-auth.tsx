"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useOptionalT } from "@/components/i18n-provider";

/**
 * The logged-out CTAs. Also used as the prerendered/SSG default and the
 * loading state while the client-only auth check resolves.
 */
export function LoggedOutButtons() {
  // useOptionalT: this also renders as the loading state of a client-only
  // import, and a header that throws is a page with no way out of it.
  const t = useOptionalT();
  return (
    <>
      <Button asChild variant="ghost" className="max-sm:hidden">
        <Link href="/login">{t("common.login")}</Link>
      </Button>
      <Button asChild>
        <Link href="/signup">{t("common.getStarted")}</Link>
      </Button>
    </>
  );
}

/**
 * The session-reading button is loaded client-only (`ssr: false`), because
 * Better Auth's `useSession` cannot run on the server. The server sends the
 * logged-out CTAs and the browser swaps in the Dashboard link for a signed-in
 * visitor.
 *
 * This used to be described as keeping the landing page static. It no longer
 * is: the page reads the language cookie and the visitor's country, so it is
 * server-rendered per request either way.
 */
const AuthAwareButtons = dynamic(
  () =>
    import("./landing-header-auth-inner").then((m) => m.LandingHeaderAuthInner),
  { ssr: false, loading: () => <LoggedOutButtons /> },
);

export function LandingHeaderAuth() {
  return <AuthAwareButtons />;
}
