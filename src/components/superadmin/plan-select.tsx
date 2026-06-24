"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setChurchPlan } from "@/app/superadmin/actions";
import { PLANS, type PlanId } from "@/lib/plans";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function PlanSelect({
  churchId,
  plan,
}: {
  churchId: string;
  plan: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Select
      value={plan}
      disabled={pending}
      onValueChange={(v) =>
        start(async () => {
          const res = await setChurchPlan(churchId, v as PlanId);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("Plan updated");
          router.refresh();
        })
      }
    >
      <SelectTrigger className="w-40" aria-label="Plan">
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
  );
}
