"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Network } from "lucide-react";
import { toast } from "sonner";
import { setChurchParent } from "@/app/superadmin/churches/[id]/actions";
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

export function ChurchNetwork({
  churchId,
  parentId,
  candidates,
  branches,
}: {
  churchId: string;
  parentId: string | null;
  /** Churches that could be the headquarters (not itself, not its branches). */
  candidates: { id: string; name: string }[];
  branches: { id: string; name: string; zone: string | null }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(parentId ?? NONE);
  const dirty = value !== (parentId ?? NONE);

  function save() {
    startTransition(async () => {
      const res = await setChurchParent({
        churchId,
        parentChurchId: value === NONE ? "" : value,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        value === NONE ? "Removed from its network." : "Headquarters set.",
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Network className="size-4" /> Church network
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={value} onValueChange={setValue} disabled={branches.length > 0}>
            <SelectTrigger
              className="w-full sm:w-72"
              aria-label="Headquarters"
              size="sm"
            >
              <SelectValue placeholder="Standalone church" />
            </SelectTrigger>
            <SelectContent searchPlaceholder="Search churches…">
              <SelectItem value={NONE}>Standalone church</SelectItem>
              {candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={save} disabled={pending || !dirty}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </div>

        {branches.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs">
              This church is a headquarters with {branches.length} branch
              {branches.length === 1 ? "" : "es"}, so it cannot become a branch
              itself.
            </p>
            <ul className="divide-y rounded-lg border text-sm">
              {branches.map((b) => (
                <li key={b.id} className="flex items-center gap-2 px-3 py-1.5">
                  <Link
                    href={`/superadmin/churches/${b.id}`}
                    className="hover:text-primary min-w-0 flex-1 truncate font-medium"
                  >
                    {b.name}
                  </Link>
                  {b.zone && (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {b.zone}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            Setting a headquarters here links the church without asking it —
            use it to fix a mistake or set up a network on request. Churches can
            invite and accept each other themselves under Branches.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
