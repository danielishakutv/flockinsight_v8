"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ArrowRight, Loader2, Plus, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteTransfer,
  recordTransfer,
  type TransferInput,
} from "@/app/(app)/finance/actions";
import { canTransferTo, transferProblem } from "@/lib/finance-shared";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export type TransferAccount = {
  id: string;
  name: string;
  isActive: boolean;
  givingCategoryId: string | null;
};

export type TransferRow = {
  id: string;
  amount: number;
  date: string;
  fromAccountId: string;
  fromAccountName: string | null;
  toAccountId: string;
  toAccountName: string | null;
  reference: string | null;
  note: string | null;
  recordedByName: string | null;
};

const NONE = "__none__";

export function TransfersManager({
  canManage,
  currency,
  accounts,
  transfers,
  today,
}: {
  canManage: boolean;
  currency: string;
  accounts: TransferAccount[];
  transfers: TransferRow[];
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const [fromId, setFromId] = useState(NONE);
  const [toId, setToId] = useState(NONE);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  // Anything can send. Only accounts that aren't giving funds can receive.
  const destinations = useMemo(
    () => accounts.filter(canTransferTo),
    [accounts],
  );

  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);
  const problem =
    fromId === NONE || toId === NONE ? null : transferProblem(from, to);

  function openAdd() {
    setFromId(NONE);
    setToId(NONE);
    setAmount("");
    setDate(today);
    setReference("");
    setNote("");
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const input: TransferInput = {
        fromAccountId: fromId,
        toAccountId: toId,
        amount,
        date,
        reference,
        note,
      };
      const res = await recordTransfer(input);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Transfer recorded");
      setOpen(false);
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteTransfer(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Transfer deleted");
      setConfirmId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">Transfers</h2>
          <p className="text-muted-foreground text-sm">
            Money moved between your own accounts. Not income or expense — the
            totals above ignore it, only the balances change.
          </p>
        </div>
        {canManage && destinations.length > 0 && accounts.length > 1 && (
          <Button onClick={openAdd}>
            <Plus className="size-4" />
            New transfer
          </Button>
        )}
      </div>

      {transfers.length === 0 ? (
        <div className="text-muted-foreground rounded-2xl border border-dashed p-8 text-center">
          <div className="bg-muted mx-auto grid size-12 place-items-center rounded-full">
            <Repeat className="size-6" />
          </div>
          <p className="mt-3 text-sm font-semibold">No transfers yet</p>
          <p className="mt-1 text-sm">
            {accounts.length < 2
              ? "You need at least two accounts to move money between them."
              : "Move money from one account to another and it will show here."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-left text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Movement</th>
                  <th className="px-4 py-3 font-semibold">Reference</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                  {canManage && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {transfers.map((t) => (
                  <tr key={t.id} className="hover:bg-muted/30">
                    <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                      {format(parseISO(t.date), "d MMM yyyy")}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex flex-wrap items-center gap-1.5 font-medium">
                        {t.fromAccountName ?? "—"}
                        <ArrowRight className="text-muted-foreground size-3.5" />
                        {t.toAccountName ?? "—"}
                      </span>
                      {t.note && (
                        <span className="text-muted-foreground block text-xs">
                          {t.note}
                        </span>
                      )}
                    </td>
                    <td className="text-muted-foreground px-4 py-3">
                      {t.reference ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap">
                      {formatMoney(t.amount, currency)}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Delete transfer"
                            onClick={() => setConfirmId(t.id)}
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
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>Move money between accounts</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>From</Label>
              <Select value={fromId} onValueChange={setFromId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick an account" />
                </SelectTrigger>
                <SelectContent
                  className="max-h-72"
                  searchPlaceholder="Search accounts…"
                >
                  <SelectItem value={NONE}>Pick an account</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                      {a.givingCategoryId ? " · fund" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>To</Label>
              <Select value={toId} onValueChange={setToId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick an account" />
                </SelectTrigger>
                <SelectContent
                  className="max-h-72"
                  searchPlaceholder="Search accounts…"
                >
                  <SelectItem value={NONE}>Pick an account</SelectItem>
                  {destinations.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Giving funds aren&apos;t listed here. They fill up from giving
                only, so nothing can be paid into one by hand — but you can move
                money out of one.
              </p>
            </div>

            {problem && (
              <p className="text-destructive bg-destructive/10 rounded-xl p-3 text-sm">
                {problem}
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="t-amount">Amount</Label>
                <Input
                  id="t-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="t-date">Date</Label>
                <Input
                  id="t-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="t-ref">Reference</Label>
              <Input
                id="t-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Teller or transaction reference"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="t-note">Note</Label>
              <Textarea
                id="t-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="What this movement was for"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={
                pending ||
                Boolean(problem) ||
                fromId === NONE ||
                toId === NONE ||
                !amount.trim()
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Record transfer
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
            <DialogTitle>Delete this transfer?</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Both account balances go back to what they were. This cannot be
            undone.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmId(null)}
              disabled={pending}
            >
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmId && remove(confirmId)}
              disabled={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
