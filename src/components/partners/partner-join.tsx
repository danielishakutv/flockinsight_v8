"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { applyToBePartner } from "@/app/partner/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** The one form that joins the programme. */
export function PartnerJoin({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [displayName, setDisplayName] = useState(defaultName);
  const [phone, setPhone] = useState("");

  function apply() {
    startTransition(async () => {
      const res = await applyToBePartner({ displayName, phone });
      if (!res.ok) return void toast.error(res.error);
      toast.success("You're in. Here is your dashboard.");
      router.push("/partner");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-semibold uppercase">
          Your name
        </label>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="As churches will know you"
        />
      </div>
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-semibold uppercase">
          Phone number
        </label>
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="08012345678"
        />
        <p className="text-muted-foreground mt-1 text-xs">
          We verify this before paying you, so use the number you actually
          answer.
        </p>
      </div>
      <Button onClick={apply} disabled={pending || displayName.trim().length < 2}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Apply to be a Partner
      </Button>
      <p className="text-muted-foreground text-xs">
        You can start sharing your link straight away. Approval is needed before
        your first withdrawal, not before your first church.
      </p>
    </div>
  );
}
