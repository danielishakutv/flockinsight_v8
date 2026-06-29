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
import { formatBytes, GB, type StorageBundle } from "@/lib/storage-bytes";
import type { StorageInfo } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StorageSettings({
  storage,
  bundles,
  balance,
  currency,
  monthlyCost,
  extraBytes,
  renewsAt,
}: {
  storage: StorageInfo;
  bundles: StorageBundle[];
  balance: number;
  currency: string;
  monthlyCost: number;
  extraBytes: number;
  renewsAt: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [acting, setActing] = useState<number | "cancel" | null>(null);

  const activeGb = Math.round(extraBytes / GB);
  const pct = storage.pct;
  const nearFull = pct >= 90;

  function subscribe(b: StorageBundle) {
    if (balance < b.price) {
      toast.error("Not enough wallet balance. Top up your wallet first.");
      return;
    }
    setActing(b.gb);
    start(async () => {
      const res = await subscribeStorage(b.gb);
      if (res.ok) {
        toast.success(`Storage upgraded to +${b.gb}GB.`);
        router.refresh();
      } else {
        toast.error(res.error);
      }
      setActing(null);
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
        toast.success("Storage add-on cancelled.");
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
              <Link href="/media">Manage files</Link>
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
                {formatMoney(monthlyCost, currency)}/mo
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
        Wallet balance: {formatMoney(balance, currency)}.
        <Link href="/settings/wallet" className="text-primary font-medium">
          Top up
        </Link>
      </div>

      {/* Bundles */}
      <div>
        <h3 className="mb-2 font-semibold">Upgrade storage</h3>
        <p className="text-muted-foreground mb-3 text-sm">
          Extra storage is a monthly subscription billed from your wallet.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {bundles.map((b) => {
            const active = activeGb === b.gb;
            const isActing = acting === b.gb && pending;
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
                    {formatMoney(b.price, currency)}
                    <span className="text-muted-foreground text-sm font-normal">
                      {" "}
                      /month
                    </span>
                  </p>
                  <Button
                    className="w-full"
                    variant={active ? "outline" : "default"}
                    disabled={pending || active}
                    onClick={() => subscribe(b)}
                  >
                    {isActing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : active ? (
                      <>
                        <Check className="size-4" /> Current
                      </>
                    ) : activeGb > 0 ? (
                      "Switch"
                    ) : (
                      "Subscribe"
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
