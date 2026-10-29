import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { Toaster } from "@/components/ui/sonner";
import { PartnerAccountBar } from "@/components/partners/partner-account-bar";
import { getIsSuperAdmin, getMyChurches, getSession } from "@/lib/session";

/**
 * The Partner side of FlockInsight: its own header, its own door.
 *
 * Two things this layout exists for:
 *
 * - The Toaster. The root layout leaves it out on purpose (see there), and
 *   nothing under /partner mounted one — so every message the Partner pages
 *   raised, "withdrawal requested", "that code is wrong", "bank details
 *   saved", went nowhere. The buttons spun and stopped and said nothing.
 *
 * - Telling account types apart. One login can be a Partner AND run a church
 *   AND operate the platform. This header says which side you are on, and
 *   offers the way across to whichever others your account has, so nobody
 *   has to sign out of one to reach another.
 *
 * Not under `(app)`, for the reason in partner/page.tsx: that shell is built
 * around the church you are in, and a Partner is not in one.
 */
export default async function PartnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const data = await getSession();
  const signedIn = !!data?.user;
  const [churches, isSuperAdmin] = signedIn
    ? await Promise.all([getMyChurches(), getIsSuperAdmin()])
    : [[], false];

  return (
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
      {/* The status bar band: an installed PWA draws behind the clock, so
          without the padding above the header's buttons sat under it. */}
      <div
        aria-hidden
        className="bg-background fixed inset-x-0 top-0 z-40 h-[env(safe-area-inset-top)]"
      />
      <header className="bg-background border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 lg:px-8">
          <Link
            href="/partners"
            className="flex min-w-0 items-center gap-2"
            aria-label="FlockInsight Partners — the programme"
          >
            <Wordmark
              logoClassName="size-7"
              className="min-w-0 text-base"
              textClassName="text-lg max-[379px]:hidden"
            />
            <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-semibold">
              Partners
            </span>
          </Link>
          <PartnerAccountBar
            account={
              signedIn
                ? {
                    email: data!.user.email ?? "",
                    hasChurch: churches.length > 0,
                    isSuperAdmin,
                  }
                : null
            }
          />
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <Toaster />
    </div>
  );
}
