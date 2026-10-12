"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Check, HardDrive, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  subscribeStorage,
  cancelStorage,
} from "@/app/(app)/settings/storage/actions";
import { formatMoney } from "@/lib/money";
import { WALLET_CURRENCY } from "@/lib/wallet-currency";
import { formatBytes, GB, type StorageBundle } from "@/lib/storage-bytes";
import type { StorageInfo } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

export function StorageSettings({
  storage,
  bundles,
  quotes,
  balance,
  monthlyCost,
  extraBytes,
  renewsAt,
}: {
  storage: StorageInfo;
  bundles: StorageBundle[];
  /**
   * Per bundle (by GB), what choosing it does to the wallet NOW — worked out
   * on the server by the same rule the action charges with. Null for the
   * bundle already running.
   */
  quotes: Record<number, { charge: number; refund: number } | null>;
  balance: number;
  monthlyCost: number;
  extraBytes: number;
  renewsAt: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [acting, setActing] = useState<number | "cancel" | null>(null);

  // Storage add-ons are paid from the wallet, and the wallet is naira — for
  // every church, wherever it is. Never the church's own currency symbol.
  const money = (n: number) => formatMoney(n, WALLET_CURRENCY);
  const activeGb = Math.round(extraBytes / GB);
  const pct = storage.pct;
  const nearFull = pct >= 90;
  // The plan's own allowance, without the add-on: what a bundle is added to.
  const baseLimit = storage.limit - extraBytes;

  function subscribe(b: StorageBundle) {
    const q = quotes[b.gb];
    if (!q) return;
    if (balance < q.charge) {
      toast.error(t("settings.notEnoughWalletBalanceTop"));
      return;
    }
    /*
     * Named, and asked. This takes money from the wallet in one tap, and on a
     * phone the tap is not always the one meant.
     */
    const what =
      activeGb > 0
        ? q.refund > 0
          ? `Switch from +${activeGb}GB to +${b.gb}GB now? ${money(q.refund)} for the unused part of this month goes back to your wallet, and +${b.gb}GB renews at ${money(b.price)}/month.`
          : `Switch from +${activeGb}GB to +${b.gb}GB now? ${money(q.charge)} is taken from your wallet for the rest of this month, then +${b.gb}GB renews at ${money(b.price)}/month.`
        : `Add +${b.gb}GB of storage? ${money(q.charge)} is taken from your wallet now, and it renews monthly.`;
    if (!confirm(what)) return;
    setActing(b.gb);
    start(async () => {
      try {
        const res = await subscribeStorage(b.gb);
        if (res.ok) {
          toast.success(`Storage is now +${b.gb}GB.`);
          router.refresh();
        } else {
          toast.error(res.error);
        }
      } catch (e) {
        console.error("storage: could not change the add-on", e);
        toast.error(
          "We couldn't reach FlockInsight. Reload the page and check your storage before trying again.",
        );
      } finally {
        setActing(null);
      }
    });
  }

  function cancel() {
    if (
      !confirm(
        "Cancel your storage add-on? Your files are kept, but you won't be able to upload more once you're over the free 200MB.",
      )
    )
      return;
    setActing("cancel");
    start(async () => {
      const res = await cancelStorage();
      if (res.ok) {
        toast.success(t("settings.storageAddOnCancelled"));
        router.refresh();
      } else {
        toast.error(res.error);
      }
      setActing(null);
    });
  }

  return (
    <div className="space-y-4">
      {/* Usage */}
      <Card>
        <CardContent className="py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="bg-primary/15 text-primary grid size-11 place-items-center rounded-xl">
                <HardDrive className="size-5" />
              </div>
              <div>
                <p className="font-semibold">
                  {formatBytes(storage.used)}{" "}
                  <span className="text-muted-foreground font-normal">
                    of {formatBytes(storage.limit)} used
                  </span>
                </p>
                <p className="text-muted-foreground text-sm">
                  {formatBytes(storage.free)} free · 200MB base
                  {activeGb > 0 ? ` + ${activeGb}GB add-on` : ""}
                </p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/media">{t("settings.manageFiles")}</Link>
            </Button>
          </div>
          <div className="bg-muted mt-3 h-2.5 w-full overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                nearFull ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Current add-on */}
      {activeGb > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p className="font-semibold">
                Active add-on: +{activeGb}GB ·{" "}
                {money(monthlyCost)}/mo
              </p>
              {renewsAt && (
                <p className="text-muted-foreground text-sm">
                  Renews {format(parseISO(renewsAt), "MMM d, yyyy")} — charged
                  from your wallet.
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={cancel}
              className="text-muted-foreground hover:text-destructive"
            >
              {acting === "cancel" && pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Cancel add-on
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Wallet hint */}
      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
        <Wallet className="size-4" />
        Wallet balance: {money(balance)}.
        <Link href="/settings/wallet" className="text-primary font-medium">
          Top up
        </Link>
      </div>

      {/* Bundles */}
      <div>
        <h3 className="mb-2 font-semibold">{t("settings.upgradeStorage")}</h3>
        <p className="text-muted-foreground mb-3 text-sm">
          Extra storage is a monthly subscription billed from your wallet.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {bundles.map((b) => {
            const active = activeGb === b.gb;
            const isActing = acting === b.gb && pending;
            const q = quotes[b.gb];
            // Would leave the church with less room than its files take up.
            const tooSmall = !active && storage.used > baseLimit + b.gb * GB;
            return (
              <Card
                key={b.gb}
                className={cn(active && "border-primary ring-primary/30 ring-1")}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-2xl font-extrabold">
                    +{b.gb}GB
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-lg font-bold">
                    {money(b.price)}
                    <span className="text-muted-foreground text-sm font-normal">
                      {" "}
                      /month
                    </span>
                  </p>
                  <Button
                    className="w-full"
                    variant={active ? "outline" : "default"}
                    disabled={pending || active || tooSmall || !q}
                    onClick={() => subscribe(b)}
                  >
                    {isActing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : active ? (
                      <>
                        <Check className="size-4" /> Current
                      </>
                    ) : activeGb > 0 && q ? (
                      q.refund > 0 ? (
                        `Switch · ${money(q.refund)} back`
                      ) : (
                        `Switch · ${money(q.charge)} now`
                      )
                    ) : (
                      "Subscribe"
                    )}
                  </Button>
                  {tooSmall && (
                    <p className="text-muted-foreground text-xs">
                      You are using {formatBytes(storage.used)}, more than this
                      plan holds.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* More storage — contact us */}
        <div className="bg-muted/40 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed p-4">
          <div>
            <p className="font-semibold">{t("settings.needMoreThan10gb")}</p>
            <p className="text-muted-foreground text-sm">
              We&apos;ll set up a custom storage plan for your church.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/help/support">{t("settings.contactUs")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
