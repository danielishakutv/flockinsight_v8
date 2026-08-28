import Link from "next/link";
import { ArrowRight, ShieldAlert } from "lucide-react";
import {
  emailVerified,
  missingVerificationLabel,
  phoneVerified,
  type VerificationFields,
} from "@/lib/verification-shared";
import { Button } from "@/components/ui/button";

/**
 * "Your church isn't verified yet" — the dashboard's standing prompt.
 *
 * Deliberately NOT dismissible, unlike the setup notices beside it. Those are
 * optional nudges; this one is a condition of the account, and hiding it on
 * one device would just mean nobody ever gets round to it.
 */
export function VerifyBanner({
  church,
  canManage,
}: {
  church: VerificationFields;
  canManage: boolean;
}) {
  const e = emailVerified(church);
  const p = phoneVerified(church);
  if (e && p) return null;

  const half = e || p;

  return (
    <div className="mb-4 flex flex-wrap items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 sm:p-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
        <ShieldAlert className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-bold">
          {half
            ? "One step left to verify your church"
            : "Verify your church account"}
        </p>
        <p className="text-muted-foreground text-sm">
          Confirm your {missingVerificationLabel(church)} so we can reach you
          about your account. Verified churches get a verification tick on their
          public page and in the church directory.
          {canManage ? "" : " Ask an admin to complete this."}
        </p>
        {canManage && (
          <Button asChild size="sm" className="mt-2">
            <Link href="/settings/verification">
              Verify now <ArrowRight className="size-4" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
