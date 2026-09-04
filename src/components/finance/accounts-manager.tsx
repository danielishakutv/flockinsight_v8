"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Smartphone,
  Trash2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteAccount,
  saveAccount,
  setAccountActive,
  unlinkFund,
  type AccountInput,
} from "@/app/(app)/finance/actions";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABEL,
  type FinanceAccountType,
} from "@/lib/finance-shared";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AccountRow = {
  id: string;
  name: string;
  type: FinanceAccountType;
  institution: string | null;
  accountNumber: string | null;
  openingBalance: number;
  isActive: boolean;
  note: string | null;
  givingCategoryId: string | null;
  givingCategoryName: string | null;
  balance: number;
  income: number;
  expense: number;
  transferredIn: number;
  transferredOut: number;
  transactionCount: number;
};

const TYPE_ICON: Record<FinanceAccountType, LucideIcon> = {
  bank: Landmark,
  cash: Banknote,
  mobile_money: Smartphone,
  other: Wallet,
};

type FormState = {
  id?: string;
  name: string;
  type: FinanceAccountType;
  institution: string;
  accountNumber: string;
  openingBalance: string;
  isActive: boolean;
  note: string;
};

function emptyForm(): FormState {
  return {
    name: "",
    type: "bank",
    institution: "",
    accountNumber: "",
    openingBalance: "",
    isActive: true,
    note: "",
  };
}

export function AccountsManager({
  canManage,
  currency,
  accounts,
}: {
  canManage: boolean;
  currency: string;
  accounts: AccountRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const set = (patch: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...patch }));

  const total = accounts
    .filter((a) => a.isActive)
    .reduce((sum, a) => sum + a.balance, 0);

  function openAdd() {
    setForm(emptyForm());
    setOpen(true);
  }

  function openEdit(a: AccountRow) {
    setForm({
      id: a.id,
      name: a.name,
      type: a.type,
      institution: a.institution ?? "",
      accountNumber: a.accountNumber ?? "",
      openingBalance: String(a.openingBalance ?? 0),
      isActive: a.isActive,
      note: a.note ?? "",
    });
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const input: AccountInput = {
        id: form.id,
        name: form.name,
        type: form.type,
        institution: form.institution,
        accountNumber: form.accountNumber,
        openingBalance: form.openingBalance,
        isActive: form.isActive,
        note: form.note,
      };
      const res = await saveAccount(input);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(form.id ? "Account updated" : "Account added");
      setOpen(false);
      router.refresh();
    });
  }

  function toggleActive(a: AccountRow) {
    startTransition(async () => {
      const res = await setAccountActive(a.id, !a.isActive);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(a.isActive ? "Account closed" : "Account reopened");
      router.refresh();
    });
  }

  function unlink(a: AccountRow) {
    startTransition(async () => {
      const res = await unlinkFund(a.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Unlinked — the account and its records are unchanged");
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteAccount(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Account removed");
      setConfirmId(null);
      router.refresh();
    });
  }

  const target = accounts.find((a) => a.id === confirmId) ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs font-semibold uppercase">
            Cash on hand
          </p>
          <p className="text-2xl font-extrabold tabular-nums">
            {formatMoney(total, currency)}
          </p>
          <p className="text-muted-foreground text-xs">
            across {accounts.filter((a) => a.isActive).length} open account
            {accounts.filter((a) => a.isActive).length === 1 ? "" : "s"}
          </p>
        </div>
        {canManage && (
          <Button onClick={openAdd}>
            <Plus className="size-4" />
            Add account
          </Button>
        )}
      </div>

      {accounts.length === 0 ? (
        <div className="text-muted-foreground rounded-2xl border border-dashed p-10 text-center">
          <div className="bg-muted mx-auto grid size-14 place-items-center rounded-full">
            <Wallet className="size-7" />
          </div>
          <p className="mt-4 font-semibold">No accounts yet</p>
          <p className="mt-1 text-sm">
            Add the church bank account, and the offering box if you keep cash.
            Balances are worked out from what you record.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {accounts.map((a) => {
            const Icon = TYPE_ICON[a.type];
            return (
              <Card key={a.id} className={cn(!a.isActive && "opacity-70")}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-full">
                        <Icon className="size-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">
                          {a.name}
                          {a.givingCategoryId && (
                            <Badge className="ml-2 text-[10px]">Fund</Badge>
                          )}
                          {!a.isActive && (
                            <Badge variant="secondary" className="ml-2 text-[10px]">
                              Closed
                            </Badge>
                          )}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {[
                            ACCOUNT_TYPE_LABEL[a.type],
                            a.institution,
                            a.accountNumber,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${a.name}`}
                          onClick={() => openEdit(a)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${a.name}`}
                          onClick={() => setConfirmId(a.id)}
                        >
                          <Trash2 className="text-destructive size-4" />
                        </Button>
                      </div>
                    )}
                  </div>

                  <p className="mt-4 text-2xl font-extrabold tabular-nums">
                    {formatMoney(a.balance, currency)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    opened at {formatMoney(a.openingBalance, currency)} ·{" "}
                    {a.transactionCount} record
                    {a.transactionCount === 1 ? "" : "s"}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +{formatMoney(a.income, currency)} in
                    </span>
                    <span className="text-rose-600 dark:text-rose-400">
                      −{formatMoney(a.expense, currency)} out
                    </span>
                    {a.transferredIn > 0 && (
                      <span className="text-muted-foreground">
                        +{formatMoney(a.transferredIn, currency)} moved in
                      </span>
                    )}
                    {a.transferredOut > 0 && (
                      <span className="text-muted-foreground">
                        −{formatMoney(a.transferredOut, currency)} moved out
                      </span>
                    )}
                  </div>

                  {a.givingCategoryId && (
                    <p className="text-muted-foreground mt-2 text-xs">
                      Fund for the{" "}
                      <span className="font-medium">
                        {a.givingCategoryName ?? "linked"}
                      </span>{" "}
                      giving category. Income arrives from giving — it can be
                      spent from or moved out, but not paid into by hand.
                    </p>
                  )}

                  {canManage && (
                    <div className="mt-3 -ml-2 flex flex-wrap gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleActive(a)}
                        disabled={pending}
                      >
                        {a.isActive ? "Close account" : "Reopen account"}
                      </Button>
                      {a.givingCategoryId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => unlink(a)}
                          disabled={pending}
                        >
                          Unlink from giving
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit account" : "Add account"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Main current account"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => set({ type: v as FinanceAccountType })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {ACCOUNT_TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="institution">Bank / provider</Label>
                <Input
                  id="institution"
                  value={form.institution}
                  onChange={(e) => set({ institution: e.target.value })}
                  placeholder="e.g. First Bank"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="accountNumber">Account number</Label>
                <Input
                  id="accountNumber"
                  value={form.accountNumber}
                  onChange={(e) => set({ accountNumber: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="openingBalance">Opening balance</Label>
                <Input
                  id="openingBalance"
                  inputMode="decimal"
                  value={form.openingBalance}
                  onChange={(e) => set({ openingBalance: e.target.value })}
                  placeholder="0.00"
                />
                <p className="text-muted-foreground text-xs">
                  What it held before you started recording here, so the balance
                  is right from day one.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">Note</Label>
              <Textarea
                id="note"
                value={form.note}
                onChange={(e) => set({ note: e.target.value })}
                rows={2}
                placeholder="Optional — who operates it, what it is for"
              />
            </div>

            {form.id && (
              <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
                <span>
                  <span className="block text-sm font-semibold">Open</span>
                  <span className="text-muted-foreground block text-xs">
                    A closed account keeps its history but stops appearing when
                    recording money.
                  </span>
                </span>
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => set({ isActive: v })}
                />
              </label>
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
              {form.id ? "Save changes" : "Add account"}
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
              ? `This account has ${target.transactionCount} record${target.transactionCount === 1 ? "" : "s"} against it, so it can't be deleted. Close it instead — that keeps the history and hides it from the forms.`
              : "This account has no records against it, so nothing will be lost."}
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
                Close it instead
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
