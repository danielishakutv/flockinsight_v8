"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { adminSetBilling } from "@/app/superadmin/actions";
import { PLANS, planName, type PlanId } from "@/lib/plans";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PaymentRow = {
  id: string;
  plan: string;
  amount: number;
  currency: string;
  status: string;
  gateway: string;
  note: string | null;
  createdAt: string;
};

export function AdminBilling({
  churchId,
  plan,
  discount,
  renewsAt,
  payments,
}: {
  churchId: string;
  plan: string;
  discount: number;
  renewsAt: string | null;
  payments: PaymentRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [planId, setPlanId] = useState(plan);
  const [disc, setDisc] = useState(String(discount));
  const [months, setMonths] = useState("0");
  const [note, setNote] = useState("");

  function save() {
    startTransition(async () => {
      const res = await adminSetBilling({
        churchId,
        plan: planId as PlanId,
        discountPct: Number(disc),
        months: Number(months),
        note,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Billing updated");
      setMonths("0");
      setNote("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Billing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Current: <span className="text-foreground font-semibold">{planName(plan)}</span>
          {discount > 0 && <> · {discount}% discount</>} ·{" "}
          {renewsAt
            ? `renews ${format(parseISO(renewsAt), "MMM d, yyyy")}`
            : "no renewal date"}
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Plan</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLANS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Discount %</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={disc}
              onChange={(e) => setDisc(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Extend (months)</Label>
            <Input
              type="number"
              min={0}
              max={36}
              value={months}
              onChange={(e) => setMonths(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Note (optional)</Label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Partner church — 100% off for 12 months"
          />
        </div>
        <Button onClick={save} disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Apply
        </Button>

        {payments.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-muted-foreground text-xs font-bold uppercase">
              Payments
            </p>
            {payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {planName(p.plan)}{" "}
                    <span className="text-muted-foreground">· {p.gateway}</span>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {format(parseISO(p.createdAt), "MMM d, yyyy")}
                    {p.note ? ` · ${p.note}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold tabular-nums">
                    {formatMoney(p.amount, p.currency)}
                  </p>
                  <Badge
                    variant={p.status === "success" ? "success" : "secondary"}
                    className="capitalize"
                  >
                    {p.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
