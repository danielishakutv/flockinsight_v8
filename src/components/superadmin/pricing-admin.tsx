"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HardDrive, Loader2, Plus, Tag, X } from "lucide-react";
import { toast } from "sonner";
import {
  setPlanPrices,
  setStorageBundlesAction,
  type PlanPriceInput,
} from "@/app/superadmin/pricing/actions";
import { PLAN_BY_ID } from "@/lib/plans";
import type { StorageBundle } from "@/lib/storage-bytes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PRICED = ["starter", "growth", "pro"] as const;

export function PricingAdmin({
  initial,
  bundles: initialBundles,
}: {
  initial: PlanPriceInput;
  bundles: StorageBundle[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState<PlanPriceInput>(initial);
  const [bundles, setBundles] = useState<StorageBundle[]>(initialBundles);
  const [savingBundles, startBundles] = useTransition();

  function save() {
    start(async () => {
      const res = await setPlanPrices(f);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Plan prices updated");
      router.refresh();
    });
  }

  function saveBundles() {
    const clean = bundles
      .map((b) => ({ gb: Math.round(Number(b.gb)), price: Math.round(Number(b.price)) }))
      .filter((b) => Number.isFinite(b.gb) && b.gb > 0 && Number.isFinite(b.price) && b.price >= 0);
    if (clean.length === 0) {
      toast.error("Add at least one storage bundle.");
      return;
    }
    startBundles(async () => {
      const res = await setStorageBundlesAction(clean);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Storage bundles updated");
      router.refresh();
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
          Pricing
        </h1>
        <p className="text-muted-foreground mt-1">
          Set the monthly price (₦) for each plan. Changes reflect on the
          landing page, the pricing page and every church&apos;s billing &
          checkout.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Tag className="text-primary size-5" /> Plan prices
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {PRICED.map((id) => {
            const meta = PLAN_BY_ID[id];
            return (
              <div
                key={id}
                className="flex flex-wrap items-end justify-between gap-3 rounded-xl border p-3"
              >
                <div>
                  <p className="font-bold">{meta.name}</p>
                  <p className="text-muted-foreground text-xs">{meta.tagline}</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`price-${id}`} className="text-xs">
                    ₦ / month
                  </Label>
                  <Input
                    id={`price-${id}`}
                    type="number"
                    min={0}
                    step="100"
                    value={f[id]}
                    onChange={(e) =>
                      setF((p) => ({ ...p, [id]: Number(e.target.value) }))
                    }
                    className="h-11 w-40 text-right font-bold tabular-nums"
                  />
                </div>
              </div>
            );
          })}
          <p className="text-muted-foreground text-xs">
            Set Starter to 0 to keep it free. Enterprise stays custom (contact
            sales) and has no fixed price.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={pending} size="lg">
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save prices
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <HardDrive className="text-primary size-5" /> Storage bundles
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Monthly storage add-ons churches can buy from their wallet (on top
            of the free 200MB base).
          </p>
          {bundles.map((b, i) => (
            <div
              key={i}
              className="flex flex-wrap items-end gap-3 rounded-xl border p-3"
            >
              <div className="space-y-1">
                <Label className="text-xs">Extra GB</Label>
                <Input
                  type="number"
                  min={1}
                  value={b.gb}
                  onChange={(e) =>
                    setBundles((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, gb: Number(e.target.value) } : x,
                      ),
                    )
                  }
                  className="h-11 w-28 text-right font-bold tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">₦ / month</Label>
                <Input
                  type="number"
                  min={0}
                  step="100"
                  value={b.price}
                  onChange={(e) =>
                    setBundles((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, price: Number(e.target.value) } : x,
                      ),
                    )
                  }
                  className="h-11 w-36 text-right font-bold tabular-nums"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                onClick={() =>
                  setBundles((prev) => prev.filter((_, j) => j !== i))
                }
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBundles((prev) => [...prev, { gb: 1, price: 500 }])}
          >
            <Plus className="size-4" /> Add bundle
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={saveBundles} disabled={savingBundles} size="lg">
          {savingBundles && <Loader2 className="size-4 animate-spin" />}
          Save storage bundles
        </Button>
      </div>
    </div>
  );
}
