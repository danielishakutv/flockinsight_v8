"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  HandCoins,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import {
  createGivingCategory,
  updateGivingCategory,
  deleteGivingCategory,
} from "@/app/(app)/settings/actions";
import { createFundForCategory } from "@/app/(app)/finance/actions";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
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
  /** The Finance account acting as this category's fund, if one is linked. */
  fundAccountId: string | null;
  fundAccountName: string | null;
  fundBalance: number | null;
  /** How much giving is already recorded here, for the backfill warning. */
  givingCount: number;
  givingTotal: number;
};

export function GivingCategoriesManager({
  categories,
  currency,
  canManageFinance,
}: {
  categories: GivingCategoryRow[];
  currency: string;
  canManageFinance: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GivingCategoryRow | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [fundFor, setFundFor] = useState<GivingCategoryRow | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [withFund, setWithFund] = useState(true);

  function openAdd() {
    setEditing(null);
    setName("");
    setDescription("");
    setWithFund(true);
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
        : await createGivingCategory({
            ...payload,
            autoFinanceAccount: withFund,
          });
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
        setConfirmId(null);
        return;
      }
      toast.success("Category deleted");
      setConfirmId(null);
      router.refresh();
    });
  }

  function createFund(c: GivingCategoryRow) {
    startTransition(async () => {
      const res = await createFundForCategory(c.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.created
          ? `Fund created — ${res.created} past gift${res.created === 1 ? "" : "s"} brought in`
          : "Fund created",
      );
      setFundFor(null);
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
              className="bg-card rounded-2xl border p-3 shadow-sm sm:p-4"
            >
              <div className="flex items-center gap-3">
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

              {/* The fund in Finance, or the offer to make one. */}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                {c.fundAccountId ? (
                  <>
                    <Badge variant="secondary" className="gap-1">
                      <Wallet className="size-3" />
                      Fund
                    </Badge>
                    <Link
                      href="/finance/accounts"
                      className="text-primary text-sm font-semibold hover:underline"
                    >
                      {c.fundAccountName}
                    </Link>
                    <span className="text-muted-foreground text-sm tabular-nums">
                      {formatMoney(c.fundBalance ?? 0, currency)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      · giving here is recorded as income automatically
                    </span>
                  </>
                ) : canManageFinance ? (
                  <>
                    <span className="text-muted-foreground text-xs">
                      No fund account — giving here isn&apos;t tracked in
                      Finance.
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setFundFor(c)}
                      disabled={pending}
                    >
                      <Wallet className="size-4" />
                      Create fund account
                    </Button>
                  </>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    No fund account in Finance.
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / edit */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined}>
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

            {/* Only on create: an existing category uses the button on its row,
                which can say how much history it is about to pull in. */}
            {!editing && canManageFinance && (
              <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
                <span>
                  <span className="block text-sm font-semibold">
                    Track this in Finance
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    Creates a fund account so giving in this category is
                    recorded as income automatically. Turn it off if you track
                    all giving in one pot.
                  </span>
                </span>
                <Switch checked={withFund} onCheckedChange={setWithFund} />
              </label>
            )}
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

      {/* Creating a fund for a category that already has history */}
      <Dialog
        open={fundFor !== null}
        onOpenChange={(o) => !pending && !o && setFundFor(null)}
      >
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Create a fund for {fundFor?.name}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              A fund account appears in Finance under this name. From then on,
              every gift recorded in this category is added to it as income
              automatically.
            </p>
            {fundFor && fundFor.givingCount > 0 ? (
              <p className="bg-muted/50 rounded-xl border p-3">
                <span className="font-semibold">
                  {fundFor.givingCount} gift
                  {fundFor.givingCount === 1 ? "" : "s"} already recorded here,
                  totalling {formatMoney(fundFor.givingTotal, currency)}
                </span>
                , will be brought in, so the fund opens with the full history
                rather than a blank balance.
              </p>
            ) : (
              <p className="text-muted-foreground">
                Nothing has been given in this category yet, so the fund starts
                empty.
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Money can be spent from a fund or moved to another account, but
              nothing can be paid into it by hand — it fills up from giving
              only, so its balance always reflects what was actually given.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFundFor(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => fundFor && createFund(fundFor)}
              disabled={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Create fund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
