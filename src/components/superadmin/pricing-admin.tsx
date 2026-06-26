"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Tag } from "lucide-react";
import { toast } from "sonner";
import {
  setPlanPrices,
  type PlanPriceInput,
} from "@/app/superadmin/pricing/actions";
import { PLAN_BY_ID } from "@/lib/plans";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PRICED = ["starter", "growth", "pro"] as const;

export function PricingAdmin({ initial }: { initial: PlanPriceInput }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState<PlanPriceInput>(initial);

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
    </div>
  );
}
