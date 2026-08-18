"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  createDenomination,
  updateDenomination,
} from "@/app/superadmin/denominations/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type DenominationValues = {
  id?: string;
  name: string;
  abbreviation: string;
  notes: string;
};

const BLANK: DenominationValues = { name: "", abbreviation: "", notes: "" };

export function DenominationDialog({
  initial,
  trigger,
  onDone,
  open: controlledOpen,
  onOpenChange,
}: {
  initial?: DenominationValues;
  trigger?: React.ReactNode;
  onDone?: () => void;
  /** Omit both to let the dialog manage itself from its trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<DenominationValues>(initial ?? BLANK);
  const editing = !!initial?.id;

  function submit() {
    if (!form.name.trim()) return toast.error("Give the denomination a name.");
    startTransition(async () => {
      const res = editing
        ? await updateDenomination({ ...form, id: initial!.id! })
        : await createDenomination(form);
      if (!res.ok) return void toast.error(res.error);
      toast.success(editing ? "Saved." : `“${form.name}” created.`);
      setOpen(false);
      if (!editing) setForm(BLANK);
      onDone?.();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button size="sm">
              <Plus className="size-4" /> New denomination
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit denomination" : "New denomination"}
          </DialogTitle>
          <DialogDescription>
            Renaming one updates the label on every church under it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="d-name">Name</Label>
            <Input
              id="d-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="The Redeemed Christian Church of God"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-abbr">Short name</Label>
            <Input
              id="d-abbr"
              value={form.abbreviation}
              onChange={(e) =>
                setForm((f) => ({ ...f, abbreviation: e.target.value }))
              }
              placeholder="RCCG"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-notes">Notes</Label>
            <Textarea
              id="d-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="National HQ in Lagos. Provincial pastors decide software for their parishes."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
