import { LogOut, ShieldAlert } from "lucide-react";
import { exitImpersonation } from "@/app/superadmin/actions";

/**
 * Sticky banner shown whenever a superadmin is operating a church on its
 * behalf. Makes the act-as state impossible to miss and gives a one-click exit.
 */
export function ImpersonationBanner({ churchName }: { churchName: string }) {
  return (
    <div className="flex items-center gap-3 bg-amber-500 px-4 py-2 text-amber-950 shadow-sm">
      <ShieldAlert className="size-4 shrink-0" />
      <p className="min-w-0 flex-1 truncate text-sm font-semibold">
        Super admin — you&apos;re working inside{" "}
        <span className="font-extrabold">{churchName}</span>. Changes you make
        apply to this church.
      </p>
      <form action={exitImpersonation}>
        <button
          type="submit"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-950 px-3 py-1.5 text-xs font-bold text-amber-50 transition-colors hover:bg-amber-900"
        >
          <LogOut className="size-3.5" />
          Exit church
        </button>
      </form>
    </div>
  );
}
