import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Shield } from "lucide-react";
import { requireSuperAdmin, getMustChangePassword } from "@/lib/session";
import { Logo } from "@/components/brand";
import { SignOutButton } from "@/components/app/sign-out-button";
import { SuperadminNav } from "@/components/superadmin/superadmin-nav";

export const metadata = { title: "Platform Admin" };

export default async function SuperadminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSuperAdmin();
  if (await getMustChangePassword()) redirect("/set-password");

  return (
    <div className="min-h-dvh">
      <header className="bg-background/80 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 lg:px-8">
          <div className="flex items-center gap-2.5">
            <Logo className="size-8" />
            <div className="leading-tight">
              <div className="flex items-center gap-1.5 font-extrabold tracking-tight">
                FlockInsight
                <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase">
                  <Shield className="size-3" /> Admin
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="text-muted-foreground hover:text-foreground hidden items-center gap-1 text-sm font-medium sm:inline-flex"
            >
              Back to app <ArrowUpRight className="size-3.5" />
            </Link>
            <SignOutButton variant="ghost" />
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <SuperadminNav />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
        {children}
      </main>
    </div>
  );
}
