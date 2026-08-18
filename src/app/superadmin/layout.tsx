import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Shield } from "lucide-react";
import { requireSuperAdmin, getMustChangePassword } from "@/lib/session";
import { Logo } from "@/components/brand";
import { SignOutButton } from "@/components/app/sign-out-button";
import {
  SuperadminMobileNav,
  SuperadminSidebar,
} from "@/components/superadmin/superadmin-nav";
import {
  CommandPalette,
  CommandPaletteHint,
} from "@/components/superadmin/command-palette";

export const metadata = { title: "Platform Admin" };

/**
 * The admin shell is deliberately quieter than the church-facing app: a slim
 * bar, a grouped sidebar, and `data-admin` on the wrapper, which tightens type
 * and card padding across everything inside (see globals.css).
 */
export default async function SuperadminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSuperAdmin();
  if (await getMustChangePassword()) redirect("/set-password");

  return (
    <div data-admin className="min-h-dvh">
      <header className="bg-background/85 sticky top-0 z-30 border-b backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-3 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <Link href="/superadmin" className="flex items-center gap-2">
              <Logo className="size-6" />
              <span className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
                FlockInsight
                <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
                  <Shield className="size-2.5" /> Admin
                </span>
              </span>
            </Link>
            <span className="bg-border hidden h-5 w-px lg:block" />
            <SuperadminMobileNav />
          </div>

          <div className="flex items-center gap-1.5">
            <CommandPaletteHint />
            <Link
              href="/dashboard"
              className="text-muted-foreground hover:text-foreground hidden items-center gap-1 text-[13px] font-medium sm:inline-flex"
            >
              Back to app <ArrowUpRight className="size-3.5" />
            </Link>
            <SignOutButton variant="ghost" size="sm" />
          </div>
        </div>
      </header>

      <div className="flex">
        <SuperadminSidebar />
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}
