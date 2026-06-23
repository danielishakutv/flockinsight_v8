"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HandCoins, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createGivingCategory,
  updateGivingCategory,
  deleteGivingCategory,
} from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type GivingCategoryRow = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

export function GivingCategoriesManager({
  categories,
}: {
  categories: GivingCategoryRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GivingCategoryRow | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function openAdd() {
    setEditing(null);
    setName("");
    setDescription("");
    setOpen(true);
  }
  function openEdit(c: GivingCategoryRow) {
    setEditing(c);
    setName(c.name);
    setDescription(c.description ?? "");
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
      };
      const res = editing
        ? await updateGivingCategory({
            id: editing.id,
            ...payload,
            isActive: editing.isActive,
          })
        : await createGivingCategory(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(editing ? "Category updated" : "Category added");
      setOpen(false);
      router.refresh();
    });
  }

  function toggleActive(c: GivingCategoryRow, next: boolean) {
    startTransition(async () => {
      const res = await updateGivingCategory({
        id: c.id,
        name: c.name,
        description: c.description,
        isActive: next,
      });
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteGivingCategory(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Category deleted");
      setConfirmId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Categories you can record giving against — e.g. Offering, Tithe,
          Building Project.
        </p>
        <Button onClick={openAdd} size="lg" className="shrink-0">
          <Plus className="size-5" />
          Add category
        </Button>
      </div>

      {categories.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="bg-primary/10 text-primary grid size-14 place-items-center rounded-2xl">
              <HandCoins className="size-7" />
            </div>
            <p className="text-muted-foreground">
              No giving categories yet. Add your first one to start recording.
            </p>
            <Button onClick={openAdd}>
              <Plus className="size-5" /> Add category
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {categories.map((c) => (
            <div
              key={c.id}
              className="bg-card flex items-center gap-3 rounded-2xl border p-3 shadow-sm sm:p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{c.name}</p>
                {c.description && (
                  <p className="text-muted-foreground truncate text-xs">
                    {c.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Switch
                  checked={c.isActive}
                  onCheckedChange={(v) => toggleActive(c, v)}
                  aria-label="Active"
                  className="mr-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Edit"
                  onClick={() => openEdit(c)}
                >
                  <Pencil className="size-4" />
                </Button>
                {confirmId === c.id ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => remove(c.id)}
                    disabled={pending}
                  >
                    {pending ? <Loader2 className="animate-spin" /> : "Confirm"}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete"
                    onClick={() => setConfirmId(c.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit category" : "Add giving category"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cat-name">Name</Label>
              <Input
                id="cat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Tithe, Offering, Building Project"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-desc">Description</Label>
              <Textarea
                id="cat-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional note about this category"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !name.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              {editing ? "Save" : "Add category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
