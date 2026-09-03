"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Sparkles, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createDefaultCategories,
  deleteCategory,
  saveCategory,
  setCategoryActive,
} from "@/app/(app)/finance/actions";
import {
  defaultCategoriesFor,
  KIND_LABEL,
  type FinanceKind,
} from "@/lib/finance-shared";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type CategoryRow = {
  id: string;
  name: string;
  kind: FinanceKind;
  isActive: boolean;
  transactionCount: number;
  total: number;
};

type FormState = {
  id?: string;
  name: string;
  kind: FinanceKind;
  isActive: boolean;
};

export function CategoriesManager({
  canManage,
  currency,
  categories,
}: {
  canManage: boolean;
  currency: string;
  categories: CategoryRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    name: "",
    kind: "expense",
    isActive: true,
  });
  const set = (patch: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...patch }));

  function openAdd(kind: FinanceKind) {
    setForm({ name: "", kind, isActive: true });
    setOpen(true);
  }

  function openEdit(c: CategoryRow) {
    setForm({ id: c.id, name: c.name, kind: c.kind, isActive: c.isActive });
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const res = await saveCategory({
        id: form.id,
        name: form.name,
        kind: form.kind,
        isActive: form.isActive,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(form.id ? "Category updated" : "Category added");
      setOpen(false);
      router.refresh();
    });
  }

  function toggleActive(c: CategoryRow) {
    startTransition(async () => {
      const res = await setCategoryActive(c.id, !c.isActive);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(c.isActive ? "Category retired" : "Category restored");
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteCategory(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Category removed");
      setConfirmId(null);
      router.refresh();
    });
  }

  function addDefaults(kind: FinanceKind) {
    startTransition(async () => {
      const res = await createDefaultCategories(kind);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Added the starting ${kind} categories`);
      router.refresh();
    });
  }

  const target = categories.find((c) => c.id === confirmId) ?? null;

  return (
    <div className="space-y-8">
      {(["income", "expense"] as FinanceKind[]).map((kind) => {
        const list = categories.filter((c) => c.kind === kind);
        return (
          <section key={kind} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold">
                  {KIND_LABEL[kind]} categories
                </h2>
                <p className="text-muted-foreground text-sm">
                  {kind === "income"
                    ? "What money the church receives is counted as."
                    : "What the church spends money on."}
                </p>
              </div>
              {canManage && (
                <div className="flex gap-2">
                  {list.length === 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => addDefaults(kind)}
                      disabled={pending}
                    >
                      <Sparkles className="size-4" />
                      Add {defaultCategoriesFor(kind).length} common ones
                    </Button>
                  )}
                  <Button size="sm" onClick={() => openAdd(kind)}>
                    <Plus className="size-4" />
                    Add
                  </Button>
                </div>
              )}
            </div>

            {list.length === 0 ? (
              <div className="text-muted-foreground rounded-2xl border border-dashed p-8 text-center">
                <div className="bg-muted mx-auto grid size-12 place-items-center rounded-full">
                  <Tags className="size-6" />
                </div>
                <p className="mt-3 text-sm font-semibold">
                  No {kind} categories yet
                </p>
                <p className="mt-1 text-sm">
                  Records still save without one — they just show as
                  &ldquo;Uncategorised&rdquo;.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground text-left text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Name</th>
                      <th className="px-4 py-3 text-right font-semibold">
                        Records
                      </th>
                      <th className="px-4 py-3 text-right font-semibold">Total</th>
                      {canManage && <th className="px-4 py-3" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {list.map((c) => (
                      <tr
                        key={c.id}
                        className={cn("hover:bg-muted/30", !c.isActive && "opacity-60")}
                      >
                        <td className="px-4 py-3 font-medium">
                          {c.name}
                          {!c.isActive && (
                            <Badge
                              variant="secondary"
                              className="ml-2 text-[10px]"
                            >
                              Retired
                            </Badge>
                          )}
                        </td>
                        <td className="text-muted-foreground px-4 py-3 text-right tabular-nums">
                          {c.transactionCount}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">
                          {formatMoney(c.total, currency)}
                        </td>
                        {canManage && (
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleActive(c)}
                                disabled={pending}
                              >
                                {c.isActive ? "Retire" : "Restore"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Edit ${c.name}`}
                                onClick={() => openEdit(c)}
                              >
                                <Pencil className="size-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Delete ${c.name}`}
                                onClick={() => setConfirmId(c.id)}
                              >
                                <Trash2 className="text-destructive size-4" />
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {form.id
                ? "Edit category"
                : `Add ${form.kind} category`}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cat-name">Name</Label>
              <Input
                id="cat-name"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder={
                  form.kind === "income" ? "e.g. Hall hire" : "e.g. Electricity"
                }
                autoFocus
              />
            </div>

            {form.id && (
              <>
                <p className="text-muted-foreground text-xs">
                  This is {form.kind === "income" ? "an income" : "an expense"}{" "}
                  category. That cannot be changed — switching it would move
                  every record filed under it to the other side of the books.
                </p>
                <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
                  <span>
                    <span className="block text-sm font-semibold">In use</span>
                    <span className="text-muted-foreground block text-xs">
                      A retired category keeps its records but stops appearing
                      on the form.
                    </span>
                  </span>
                  <Switch
                    checked={form.isActive}
                    onCheckedChange={(v) => set({ isActive: v })}
                  />
                </label>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {form.id ? "Save changes" : "Add category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmId !== null}
        onOpenChange={(o) => !pending && !o && setConfirmId(null)}
      >
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Delete {target?.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {target && target.transactionCount > 0
              ? `${target.transactionCount} record${target.transactionCount === 1 ? " is" : "s are"} filed under this, so it can't be deleted. Retire it instead — the records keep their label.`
              : "Nothing is filed under this category, so nothing will be lost."}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmId(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            {target && target.transactionCount > 0 ? (
              <Button
                onClick={() => {
                  toggleActive(target);
                  setConfirmId(null);
                }}
                disabled={pending}
              >
                Retire it instead
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={() => confirmId && remove(confirmId)}
                disabled={pending}
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                Delete
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
