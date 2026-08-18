"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Merge, MoreHorizontal, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  archiveDenomination,
  mergeDenomination,
  restoreDenomination,
} from "@/app/superadmin/denominations/actions";
import {
  DenominationDialog,
  type DenominationValues,
} from "@/components/superadmin/denomination-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DenominationRowActions({
  denomination,
  others,
  archived = false,
}: {
  denomination: DenominationValues & { id: string };
  others: { id: string; name: string }[];
  archived?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [target, setTarget] = useState(others[0]?.id ?? "");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "That didn't work.");
      toast.success(done);
      setMergeOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Denomination actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil className="size-4" /> Edit
          </DropdownMenuItem>
          {!archived && others.length > 0 && (
            <DropdownMenuItem onSelect={() => setMergeOpen(true)}>
              <Merge className="size-4" /> Merge into…
            </DropdownMenuItem>
          )}
          {archived ? (
            <DropdownMenuItem
              onSelect={() =>
                run(() => restoreDenomination(denomination.id), "Restored.")
              }
            >
              <ArchiveRestore className="size-4" /> Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() =>
                run(() => archiveDenomination(denomination.id), "Archived.")
              }
            >
              <Archive className="size-4" /> Archive
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DenominationDialog
        initial={denomination}
        open={editOpen}
        onOpenChange={setEditOpen}
        onDone={() => setEditOpen(false)}
      />

      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Merge “{denomination.name}”</DialogTitle>
            <DialogDescription>
              Its churches move to the denomination you pick, and this one is
              archived — nothing is deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Merge into</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="w-full" aria-label="Merge into">
                <SelectValue placeholder="Choose a denomination" />
              </SelectTrigger>
              <SelectContent searchPlaceholder="Search denominations…">
                {others.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setMergeOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={pending || !target}
              onClick={() =>
                run(
                  () =>
                    mergeDenomination({ fromId: denomination.id, intoId: target }),
                  "Merged.",
                )
              }
            >
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
