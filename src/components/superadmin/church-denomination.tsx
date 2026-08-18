"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Church, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setChurchDenomination } from "@/app/superadmin/denominations/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "__none__";

export function ChurchDenomination({
  churchId,
  current,
  typedLabel,
  options,
}: {
  churchId: string;
  current: string | null;
  /** What the church itself typed on its public page, if anything. */
  typedLabel: string | null;
  options: { id: string; name: string; abbreviation: string | null }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(current ?? NONE);

  const dirty = value !== (current ?? NONE);

  function save() {
    startTransition(async () => {
      const res = await setChurchDenomination({
        churchId,
        denominationId: value === NONE ? "" : value,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        value === NONE ? "Removed from its denomination." : "Denomination set.",
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Church className="size-4" /> Denomination
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger
              className="w-full sm:w-72"
              aria-label="Denomination"
              size="sm"
            >
              <SelectValue placeholder="Not grouped" />
            </SelectTrigger>
            <SelectContent searchPlaceholder="Search denominations…">
              <SelectItem value={NONE}>Not grouped</SelectItem>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                  {o.abbreviation ? ` (${o.abbreviation})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={save} disabled={pending || !dirty}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          {typedLabel
            ? `The church typed “${typedLabel}” on its own page. `
            : "The church hasn't set a denomination on its own page. "}
          Setting it here also updates that label.{" "}
          <Link href="/superadmin/denominations" className="text-primary">
            Manage denominations
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
