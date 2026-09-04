"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Pencil,
  Plus,
  Scale,
  SearchX,
  Settings2,
  Trash2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteTransaction,
  saveTransaction,
  type TransactionInput,
} from "@/app/(app)/finance/actions";
import {
  FinanceFilters,
} from "@/components/finance/finance-filters";
import {
  canRecordIncomeInto,
  financeFilterQuery,
  FINANCE_METHODS,
  KIND_LABEL,
  METHOD_LABEL,
  shareOfTotal,
  type FinanceFilterState,
  type FinanceKind,
} from "@/lib/finance-shared";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

export type TransactionRow = {
  id: string;
  kind: FinanceKind;
  amount: number;
  date: string;
  accountId: string | null;
  accountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  party: string | null;
  reference: string | null;
  method: string | null;
  note: string | null;
  recordedByName: string | null;
};

type Option = { id: string; name: string };
type CategoryOption = Option & { kind: FinanceKind };
type AccountOption = Option & {
  isActive: boolean;
  givingCategoryId: string | null;
};

const NONE = "__none__";

type FormState = {
  id?: string;
  kind: FinanceKind;
  amount: string;
  date: string;
  accountId: string;
  categoryId: string;
  party: string;
  reference: string;
  method: string;
  note: string;
};

export function FinanceClient({
  canManage,
  currency,
  accounts,
  categories,
  rows,
  today,
  summary,
  filters,
  resultCount,
  page,
  pageSize,
  hasAnyRecords,
  hasAnyAccounts,
}: {
  canManage: boolean;
  currency: string;
  accounts: AccountOption[];
  categories: CategoryOption[];
  rows: TransactionRow[];
  today: string;
  summary: {
    income: number;
    expense: number;
    net: number;
    cashOnHand: number;
    byCategory: { id: string | null; name: string; kind: FinanceKind; total: number }[];
  };
  filters: FinanceFilterState;
  resultCount: number;
  page: number;
  pageSize: number;
  hasAnyRecords: boolean;
  hasAnyAccounts: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function emptyForm(kind: FinanceKind = "expense"): FormState {
    return {
      kind,
      amount: "",
      date: today,
      accountId: accounts[0]?.id ?? NONE,
      categoryId: NONE,
      party: "",
      reference: "",
      method: NONE,
      note: "",
    };
  }
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const set = (patch: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...patch }));

  const pageCount = Math.max(1, Math.ceil(resultCount / pageSize));
  const firstShown = resultCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = (page - 1) * pageSize + rows.length;

  function goToPage(next: number) {
    const qs = financeFilterQuery(filters, next);
    startTransition(() => router.push(`/finance${qs ? `?${qs}` : ""}`));
  }

  function openAdd(kind: FinanceKind) {
    setForm(emptyForm(kind));
    setOpen(true);
  }

  function openEdit(r: TransactionRow) {
    setForm({
      id: r.id,
      kind: r.kind,
      amount: String(r.amount),
      date: r.date,
      accountId: r.accountId ?? NONE,
      categoryId: r.categoryId ?? NONE,
      party: r.party ?? "",
      reference: r.reference ?? "",
      method: r.method ?? NONE,
      note: r.note ?? "",
    });
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const input: TransactionInput = {
        id: form.id,
        kind: form.kind,
        amount: form.amount,
        date: form.date,
        accountId: form.accountId === NONE ? "" : form.accountId,
        categoryId: form.categoryId === NONE ? "" : form.categoryId,
        party: form.party,
        reference: form.reference,
        method: form.method === NONE ? "" : form.method,
        note: form.note,
      };
      const res = await saveTransaction(input);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(form.id ? "Record updated" : "Record saved");
      setOpen(false);
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteTransaction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Record deleted");
      setConfirmId(null);
      router.refresh();
    });
  }

  // Only categories on the same side of the books as the record being written.
  const categoriesForKind = categories.filter((c) => c.kind === form.kind);
  // A giving fund fills up from giving alone, so it is not offered as a place
  // to type income into. Spending from one is ordinary, so expenses see them all.
  const accountsForKind =
    form.kind === "income" ? accounts.filter(canRecordIncomeInto) : accounts;
  const exportQuery = financeFilterQuery(filters);
  const topCategories = summary.byCategory.filter((c) => c.total > 0).slice(0, 6);
  const biggest = topCategories[0]?.total ?? 0;

  return (
    <div className="space-y-6">
      {/* Headline figures */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Income"
          value={formatMoney(summary.income, currency)}
          icon={ArrowDownLeft}
          tone="text-emerald-600 dark:text-emerald-400"
          hint="in the selected range"
        />
        <StatCard
          label="Expenses"
          value={formatMoney(summary.expense, currency)}
          icon={ArrowUpRight}
          tone="text-rose-600 dark:text-rose-400"
          hint="in the selected range"
        />
        <StatCard
          label="Net"
          value={formatMoney(summary.net, currency)}
          icon={Scale}
          tone={
            summary.net < 0
              ? "text-rose-600 dark:text-rose-400"
              : "text-foreground"
          }
          hint={summary.net < 0 ? "spent more than received" : "income less expenses"}
        />
        <StatCard
          label="Cash on hand"
          value={formatMoney(summary.cashOnHand, currency)}
          icon={Wallet}
          tone="text-foreground"
          hint="across all open accounts, today"
        />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {canManage && (
          <>
            <Button onClick={() => openAdd("income")}>
              <Plus className="size-4" />
              Record income
            </Button>
            <Button variant="outline" onClick={() => openAdd("expense")}>
              <Plus className="size-4" />
              Record expense
            </Button>
          </>
        )}
        <Button asChild variant="ghost">
          <Link href="/finance/accounts">
            <Wallet className="size-4" />
            Accounts
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/finance/categories">
            <Settings2 className="size-4" />
            Categories
          </Link>
        </Button>
        {hasAnyRecords && (
          <Button asChild variant="ghost" className="ml-auto">
            <Link
              href={`/finance/export${exportQuery ? `?${exportQuery}` : ""}`}
              prefetch={false}
            >
              <Download className="size-4" />
              <span className="hidden sm:inline">Export CSV</span>
            </Link>
          </Button>
        )}
      </div>

      {!hasAnyAccounts && canManage && (
        <div className="bg-muted/40 rounded-2xl border border-dashed p-4 text-sm">
          <p className="font-semibold">Add an account first</p>
          <p className="text-muted-foreground mt-1">
            You can record money without one, but naming where it sits — the
            bank account, the offering box — is what makes the balances mean
            something.{" "}
            <Link href="/finance/accounts" className="text-primary font-semibold hover:underline">
              Set up accounts
            </Link>
          </p>
        </div>
      )}

      {/* Where the money went */}
      {topCategories.length > 0 && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-sm font-bold">Biggest lines in this range</h2>
            {topCategories.map((c) => (
              <div key={`${c.kind}-${c.id ?? "none"}`} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium">
                    {c.name}
                    <Badge
                      variant="secondary"
                      className="ml-2 align-middle text-[10px]"
                    >
                      {KIND_LABEL[c.kind]}
                    </Badge>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {formatMoney(c.total, currency)}
                  </span>
                </div>
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      c.kind === "income" ? "bg-emerald-500" : "bg-rose-500",
                    )}
                    style={{ width: `${shareOfTotal(c.total, biggest)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <FinanceFilters
        value={filters}
        accounts={accounts}
        categories={categories}
        today={today}
        resultCount={resultCount}
        resultSummary={`${formatMoney(summary.income, currency)} in · ${formatMoney(summary.expense, currency)} out`}
      />

      {/* Ledger */}
      {rows.length === 0 ? (
        <div className="text-muted-foreground rounded-2xl border border-dashed p-10 text-center">
          <div className="bg-muted mx-auto grid size-14 place-items-center rounded-full">
            <SearchX className="size-7" />
          </div>
          <p className="mt-4 font-semibold">
            {hasAnyRecords ? "Nothing matches those filters" : "No records yet"}
          </p>
          <p className="mt-1 text-sm">
            {hasAnyRecords
              ? "Try widening the date range or clearing a filter."
              : canManage
                ? "Record your first income or expense to start the books."
                : "Once someone records income or expenses, they will show here."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-left text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Details</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Account</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                  {canManage && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                      {format(parseISO(r.date), "d MMM yyyy")}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">
                        {r.party || (r.kind === "income" ? "Income" : "Expense")}
                      </span>
                      {(r.reference || r.method || r.note) && (
                        <span className="text-muted-foreground block text-xs">
                          {[
                            r.method
                              ? METHOD_LABEL[r.method as "cash"] ?? r.method
                              : null,
                            r.reference,
                            r.note,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                    </td>
                    <td className="text-muted-foreground px-4 py-3">
                      {r.categoryName ?? "—"}
                    </td>
                    <td className="text-muted-foreground px-4 py-3">
                      {r.accountName ?? "—"}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap",
                        r.kind === "income"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400",
                      )}
                    >
                      {r.kind === "income" ? "+" : "−"}
                      {formatMoney(r.amount, currency)}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Edit record"
                            onClick={() => openEdit(r)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Delete record"
                            onClick={() => setConfirmId(r.id)}
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

      {pageCount > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            Showing {firstShown}–{lastShown} of {resultCount}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1 || pending}
            >
              <ChevronLeft className="size-4" />
              Prev
            </Button>
            <span className="text-muted-foreground text-sm tabular-nums">
              {page} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(page + 1)}
              disabled={page >= pageCount || pending}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Record / edit */}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>
              {form.id
                ? "Edit record"
                : form.kind === "income"
                  ? "Record income"
                  : "Record expense"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Switching kind clears the category: an expense filed under an
                income line would corrupt every breakdown. */}
            <div className="grid grid-cols-2 gap-2">
              {(["income", "expense"] as FinanceKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set({ kind: k, categoryId: NONE })}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors",
                    form.kind === k
                      ? k === "income"
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                      : "text-muted-foreground hover:bg-accent/40",
                  )}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount</Label>
                <Input
                  id="amount"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(e) => set({ amount: e.target.value })}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={form.date}
                  onChange={(e) => set({ date: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.categoryId}
                  onValueChange={(v) => set({ categoryId: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Uncategorised" />
                  </SelectTrigger>
                  <SelectContent
                    className="max-h-72"
                    searchPlaceholder="Search categories…"
                  >
                    <SelectItem value={NONE}>Uncategorised</SelectItem>
                    {categoriesForKind.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {categoriesForKind.length === 0 && (
                  <p className="text-muted-foreground text-xs">
                    No {form.kind} categories yet —{" "}
                    <Link
                      href="/finance/categories"
                      className="text-primary font-semibold hover:underline"
                    >
                      add some
                    </Link>
                    .
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Account</Label>
                <Select
                  value={form.accountId}
                  onValueChange={(v) => set({ accountId: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Not specified" />
                  </SelectTrigger>
                  <SelectContent
                    className="max-h-72"
                    searchPlaceholder="Search accounts…"
                  >
                    <SelectItem value={NONE}>Not specified</SelectItem>
                    {accountsForKind.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.kind === "income" &&
                  accountsForKind.length < accounts.length && (
                    <p className="text-muted-foreground text-xs">
                      Giving funds aren&apos;t listed — they receive income from
                      giving only. Record the gift in Giving instead.
                    </p>
                  )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="party">
                  {form.kind === "income" ? "Received from" : "Paid to"}
                </Label>
                <Input
                  id="party"
                  value={form.party}
                  onChange={(e) => set({ party: e.target.value })}
                  placeholder={
                    form.kind === "income" ? "e.g. Hall hire — Ada" : "e.g. IKEDC"
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Method</Label>
                <Select
                  value={form.method}
                  onValueChange={(v) => set({ method: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not specified</SelectItem>
                    {FINANCE_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {METHOD_LABEL[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reference">Reference</Label>
              <Input
                id="reference"
                value={form.reference}
                onChange={(e) => set({ reference: e.target.value })}
                placeholder="Cheque or teller number, invoice reference"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">Note</Label>
              <Textarea
                id="note"
                value={form.note}
                onChange={(e) => set({ note: e.target.value })}
                placeholder="Anything the next person reading the books should know"
                rows={2}
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
            <Button onClick={save} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {form.id ? "Save changes" : "Save record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={confirmId !== null}
        onOpenChange={(o) => !pending && !o && setConfirmId(null)}
      >
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Delete this record?</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            It will be removed from the ledger and from every total. This cannot
            be undone.
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

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  hint,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: string;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2">
          <Icon className={cn("size-4 shrink-0", tone)} />
          <span className="text-muted-foreground text-xs font-semibold uppercase">
            {label}
          </span>
        </div>
        <p className={cn("mt-2 text-xl font-extrabold tabular-nums", tone)}>
          {value}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}
