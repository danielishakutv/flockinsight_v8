"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { LoggedOutButtons } from "./landing-header-auth";

/**
 * Client-only auth-aware header buttons. Loaded via a dynamic `ssr: false`
 * import from `landing-header-auth.tsx`, so `useSession` only ever runs in
 * the browser and the landing page stays statically prerenderable.
 */
export function LandingHeaderAuthInner() {
  const { data: session } = useSession();

  if (session?.user) {
    return (
      <Button asChild>
        <Link href="/dashboard">
          Dashboard <ArrowRight className="size-4" />
        </Link>
      </Button>
    );
  }

  return <LoggedOutButtons />;
}
