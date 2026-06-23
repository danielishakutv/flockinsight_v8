"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  CalendarDays,
  Coins,
  HandCoins,
  Loader2,
  Pencil,
  Plus,
  TrendingUp,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import {
  recordGiving,
  deleteGiving,
  type GivingInput,
} from "@/app/(app)/giving/actions";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { StatCard } from "@/components/app/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export type GivingMethod =
  | "cash"
  | "transfer"
  | "card"
  | "cheque"
  | "online"
  | "other";

export type GivingRow = {
  id: string;
  amount: number;
  date: string;
  method: GivingMethod | null;
  note: string | null;
  categoryId: string | null;
  categoryName: string | null;
  memberId: string | null;
  giverName: string | null;
};

type Option = { id: string; name: string };

const METHODS: GivingMethod[] = [
  "cash",
  "transfer",
  "card",
  "cheque",
  "online",
  "other",
];
const METHOD_LABEL: Record<GivingMethod, string> = {
  cash: "Cash",
  transfer: "Transfer",
  card: "Card",
  cheque: "Cheque",
  online: "Online",
  other: "Other",
};

const NONE = "__none__";

type FormState = {
  id?: string;
  amount: string;
  categoryId: string;
  date: string;
  memberId: string;
  giverName: string;
  method: string;
  note: string;
};

export function GivingClient({
  currency,
  categories,
  members,
  records,
  today,
  monthTotal,
  yearTotal,
  allTimeTotal,
  breakdown,
  year,
}: {
  currency: string;
  categories: Option[];
  members: Option[];
  records: GivingRow[];
  today: string;
  monthTotal: number;
  yearTotal: number;
  allTimeTotal: number;
  breakdown: { name: string; total: number }[];
  year: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function emptyForm(): FormState {
    return {
      amount: "",
      categoryId: categories[0]?.id ?? NONE,
      date: today,
      memberId: NONE,
      giverName: "",
      method: NONE,
      note: "",
    };
  }
  const [form, setForm] = useState<FormState>(emptyForm);
  const set = (patch: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...patch }));

  const filtered = useMemo(() => {
    if (filter === "all") return records;
    if (filter === "uncategorised")
      return records.filter((r) => !r.categoryId);
    return records.filter((r) => r.categoryId === filter);
  }, [records, filter]);

  function openAdd() {
    setForm(emptyForm());
    setOpen(true);
  }
  function openEdit(r: GivingRow) {
    setForm({
      id: r.id,
      amount: String(r.amount),
      categoryId: r.categoryId ?? NONE,
      date: r.date,
      memberId: r.memberId ?? NONE,
      giverName: r.memberId ? "" : (r.giverName ?? ""),
      method: r.method ?? NONE,
      note: r.note ?? "",
    });
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const input: GivingInput = {
        id: form.id,
        amount: form.amount,
        categoryId: form.categoryId === NONE ? "" : form.categoryId,
        date: form.date,
        memberId: form.memberId === NONE ? "" : form.memberId,
        giverName: form.memberId === NONE ? form.giverName : "",
        method: form.method === NONE ? "" : form.method,
        note: form.note,
      };
      const res = await recordGiving(input);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(form.id ? "Giving updated" : "Giving recorded");
      setOpen(false);
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteGiving(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Record deleted");
      setConfirmId(null);
      router.refresh();
    });
  }

  const noCategories = categories.length === 0;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4">
        <StatCard
          label="This month"
          value={formatMoneyCompact(monthTotal, currency)}
          sub={format(parseISO(today), "MMMM yyyy")}
          icon={Wallet}
          accent
        />
        <StatCard
          label="This year"
          value={formatMoneyCompact(yearTotal, currency)}
          sub={String(year)}
          icon={CalendarDays}
        />
        <StatCard
          label="All time"
          value={formatMoneyCompact(allTimeTotal, currency)}
          sub="Total recorded"
          icon={TrendingUp}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {records.length} record{records.length === 1 ? "" : "s"}
        </p>
        <Button onClick={openAdd} size="lg">
          <Plus className="size-5" />
          Record giving
        </Button>
      </div>

      {/* Breakdown by category (this year) */}
      {breakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Coins className="text-primary size-5" />
              By category · {year}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {breakdown.map((b) => {
              const pct =
                yearTotal > 0 ? Math.round((b.total / yearTotal) * 100) : 0;
              return (
                <div key={b.name} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{b.name}</span>
                    <span className="font-bold tabular-nums">
                      {formatMoney(b.total, currency)}
                    </span>
                  </div>
                  <div className="bg-muted h-2 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      {categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            label="All"
          />
          {categories.map((c) => (
            <FilterChip
              key={c.id}
              active={filter === c.id}
              onClick={() => setFilter(c.id)}
              label={c.name}
            />
          ))}
        </div>
      )}

      {/* Records */}
      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="bg-primary/10 text-primary grid size-14 place-items-center rounded-2xl">
              <HandCoins className="size-7" />
            </div>
            <p className="text-muted-foreground">
              {records.length === 0
                ? "No giving recorded yet."
                : "No records in this category."}
            </p>
            {records.length === 0 && (
              <Button onClick={openAdd}>
                <Plus className="size-5" /> Record your first gift
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <div
              key={r.id}
              className="bg-card flex items-center gap-3 rounded-2xl border p-3 shadow-sm"
            >
              <div className="bg-primary/10 text-primary grid size-11 shrink-0 place-items-center rounded-xl">
                <HandCoins className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-extrabold tabular-nums">
                    {formatMoney(r.amount, currency)}
                  </span>
                  <Badge variant="secondary">
                    {r.categoryName ?? "Uncategorised"}
                  </Badge>
                  {r.method && (
                    <Badge variant="outline">{METHOD_LABEL[r.method]}</Badge>
                  )}
                </div>
                <p className="text-muted-foreground truncate text-xs">
                  {format(parseISO(r.date), "MMM d, yyyy")}
                  {r.giverName ? ` · ${r.giverName}` : ""}
                  {r.note ? ` · ${r.note}` : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit"
                onClick={() => openEdit(r)}
              >
                <Pencil className="size-4" />
              </Button>
              {confirmId === r.id ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => remove(r.id)}
                  disabled={pending}
                >
                  {pending ? <Loader2 className="animate-spin" /> : "Confirm"}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete"
                  onClick={() => setConfirmId(r.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Record / edit dialog */}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Edit giving" : "Record giving"}
            </DialogTitle>
          </DialogHeader>

          {noCategories ? (
            <p className="text-muted-foreground text-sm">
              Add at least one giving category in{" "}
              <span className="font-semibold">Settings → Giving</span> first.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
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
                  <Label>Category</Label>
                  <Select
                    value={form.categoryId}
                    onValueChange={(v) => set({ categoryId: v })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={NONE}>Uncategorised</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="date">Date</Label>
                  <Input
                    id="date"
                    type="date"
                    value={form.date}
                    onChange={(e) => set({ date: e.target.value })}
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
                      {METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {METHOD_LABEL[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Giver (optional)</Label>
                <Select
                  value={form.memberId}
                  onValueChange={(v) =>
                    set({ memberId: v, giverName: v === NONE ? form.giverName : "" })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Anonymous / general" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NONE}>Anonymous / general</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.memberId === NONE && (
                  <Input
                    value={form.giverName}
                    onChange={(e) => set({ giverName: e.target.value })}
                    placeholder="Or type a giver name (if not a member)"
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="note">Note</Label>
                <Textarea
                  id="note"
                  value={form.note}
                  onChange={(e) => set({ note: e.target.value })}
                  placeholder="Optional reference or note"
                  rows={2}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={pending || noCategories || !form.amount.trim()}
            >
              {pending && <Loader2 className="animate-spin" />}
              {form.id ? "Save changes" : "Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "bg-primary text-primary-foreground rounded-full px-3 py-1.5 text-sm font-semibold"
          : "bg-muted text-muted-foreground hover:bg-muted/70 rounded-full px-3 py-1.5 text-sm font-semibold"
      }
    >
      {label}
    </button>
  );
}
