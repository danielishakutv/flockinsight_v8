import Link from "next/link";
import { Mail, MessageSquare, Plus, Send, Wallet } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Wallet balance + this-month email/SMS usage + quick actions. Wallet & SMS are
 * priced in NGN (Paystack), so amounts show in NGN regardless of the church's
 * display currency.
 */
export function WalletCard({
  walletBalance,
  emailUsed,
  emailAllowance,
  smsSent,
  smsAffordable,
  smsAvailable,
  country,
  smsApproved,
}: {
  walletBalance: number;
  emailUsed: number;
  emailAllowance: number | null;
  smsSent: number;
  smsAffordable: number | null;
  smsAvailable: boolean;
  country: string;
  smsApproved: boolean;
}) {
  const emailPct =
    emailAllowance && emailAllowance > 0
      ? Math.min(100, Math.round((emailUsed / emailAllowance) * 100))
      : 0;
  const emailOver = emailAllowance != null && emailUsed > emailAllowance;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Wallet className="text-primary size-5" /> Wallet &amp; messaging
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">Wallet balance</p>
            <p className="truncate text-2xl font-extrabold tabular-nums">
              {formatMoney(walletBalance, "NGN")}
            </p>
          </div>
          <Button asChild size="sm">
            <Link href="/settings/wallet">
              <Plus className="size-4" /> Top up
            </Link>
          </Button>
        </div>

        {/* Email usage */}
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium">
              <Mail className="size-3.5" /> Emails this month
            </span>
            <span className="text-muted-foreground tabular-nums">
              {emailUsed.toLocaleString()}
              {emailAllowance != null ? ` / ${emailAllowance.toLocaleString()}` : ""}
            </span>
          </div>
          {emailAllowance != null ? (
            <>
              <div className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
                <div
                  className={emailOver ? "bg-destructive h-full" : "bg-primary h-full"}
                  style={{ width: `${emailPct}%` }}
                />
              </div>
              {emailOver && (
                <p className="text-destructive mt-1 text-xs">
                  Over your monthly allowance.
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground mt-1 text-xs">Unlimited on your plan.</p>
          )}
        </div>

        {/* SMS usage */}
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium">
              <MessageSquare className="size-3.5" /> SMS this month
            </span>
            <span className="text-muted-foreground tabular-nums">
              {smsSent.toLocaleString()} sent
            </span>
          </div>
          {!smsAvailable ? (
            <p className="mt-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
              SMS isn&apos;t available in {country} yet — we&apos;re working on it
              and it&apos;s coming soon.
            </p>
          ) : !smsApproved ? (
            <p className="text-muted-foreground mt-1 text-xs">
              <Link href="/settings/sms" className="text-primary underline">
                Get your sender ID approved
              </Link>{" "}
              to start sending SMS.
            </p>
          ) : smsAffordable != null ? (
            <p className="text-muted-foreground mt-1 text-xs">
              ≈ {smsAffordable.toLocaleString()} more with your balance.
            </p>
          ) : null}
        </div>

        {/* One action only — "Top up" above already covers buying credit. */}
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href="/communication">
            <Send className="size-4" /> Send a message
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
