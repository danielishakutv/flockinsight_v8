"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Church, Loader2, LogIn, LogOut, Shield } from "lucide-react";
import { toast } from "sonner";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

/**
 * The right-hand side of the Partner header.
 *
 * Signed out: one way in, which comes back here afterwards. Signed in: the
 * other sides of the same account, if it has any, and a way out. Labels drop
 * to icons on a phone, with the words kept for screen readers.
 */
export function PartnerAccountBar({
  account,
}: {
  account: {
    email: string;
    hasChurch: boolean;
    isSuperAdmin: boolean;
  } | null;
}) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  if (!account) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href="/login?redirect=%2Fpartner">
          <LogIn className="size-4" />
          Log in
        </Link>
      </Button>
    );
  }

  async function leave() {
    setLeaving(true);
    const { error } = await signOut();
    if (error) {
      setLeaving(false);
      toast.error(error.message || "We couldn't sign you out. Try again.");
      return;
    }
    router.push("/login?redirect=%2Fpartner");
    router.refresh();
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      {account.hasChurch && (
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard" title="Open your church">
            <Church className="size-4" />
            <span className="max-sm:sr-only">Your church</span>
          </Link>
        </Button>
      )}
      {account.isSuperAdmin && (
        <Button asChild variant="ghost" size="sm">
          <Link href="/superadmin" title="Platform admin">
            <Shield className="size-4" />
            <span className="max-sm:sr-only">Platform admin</span>
          </Link>
        </Button>
      )}
      <span
        className="text-muted-foreground hidden max-w-48 truncate px-2 text-xs md:inline"
        title={account.email}
      >
        {account.email}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={leave}
        disabled={leaving}
        title="Sign out"
      >
        {leaving ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <LogOut className="size-4" />
        )}
        <span className="max-sm:sr-only">Sign out</span>
      </Button>
    </div>
  );
}
