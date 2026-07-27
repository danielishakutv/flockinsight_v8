"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  CalendarDays,
  Check,
  Coins,
  HandCoins,
  HardHat,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  recordGiving,
  deleteGiving,
  type GivingInput,
} from "@/app/(app)/giving/actions";
import { createGivingCategories } from "@/app/(app)/settings/actions";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  projectId: string | null;
  projectName: string | null;
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
  sendReceipt: boolean;
};

export function GivingClient({
  canManage,
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
  receiptsEnabled = false,
}: {
  canManage: boolean;
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
  receiptsEnabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
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
      // Default to on when the church has receipts enabled, so a gift recorded
      // against a member notifies them unless the recorder opts out.
      sendReceipt: receiptsEnabled,
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
      // Editing an existing record never re-sends a receipt.
      sendReceipt: false,
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
        // Only meaningful for a new gift tied to a member.
        sendReceipt:
          !form.id && form.memberId !== NONE && form.sendReceipt,
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
      {/* Summary — on phones: a full-width hero for the month + two below.
          On larger screens: three equal cards. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <SummaryCard
          label="This month"
          value={formatMoney(monthTotal, currency)}
          sub={format(parseISO(today), "MMMM yyyy")}
          icon={Wallet}
          accent
          className="col-span-2 sm:col-span-1"
          valueClassName="text-3xl sm:text-2xl lg:text-3xl"
        />
        <SummaryCard
          label="This year"
          value={formatMoney(yearTotal, currency)}
          sub={String(year)}
          icon={CalendarDays}
          valueClassName="text-xl sm:text-2xl lg:text-3xl"
        />
        <SummaryCard
          label="All time"
          value={formatMoney(allTimeTotal, currency)}
          sub="Total recorded"
          icon={TrendingUp}
          valueClassName="text-xl sm:text-2xl lg:text-3xl"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {records.length} record{records.length === 1 ? "" : "s"}
        </p>
        {canManage &&
          (noCategories ? (
            <Button onClick={() => setSetupOpen(true)} size="lg">
              <Sparkles className="size-5" />
              Set up giving
            </Button>
          ) : (
            <Button onClick={openAdd} size="lg">
              <Plus className="size-5" />
              Record giving
            </Button>
          ))}
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
                ? noCategories
                  ? "Set up your giving categories to start recording."
                  : "No giving recorded yet."
                : "No records in this category."}
            </p>
            {canManage &&
              records.length === 0 &&
              (noCategories ? (
                <Button onClick={() => setSetupOpen(true)}>
                  <Sparkles className="size-5" /> Add giving categories
                </Button>
              ) : (
                <Button onClick={openAdd}>
                  <Plus className="size-5" /> Record your first gift
                </Button>
              ))}
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
                  {r.projectId && (
                    <Link href={`/giving/projects/${r.projectId}`}>
                      <Badge variant="default" className="gap-1">
                        <HardHat className="size-3" />
                        {r.projectName ?? "Project"}
                      </Badge>
                    </Link>
                  )}
                </div>
                <p className="text-muted-foreground truncate text-xs">
                  {format(parseISO(r.date), "MMM d, yyyy")}
                  {r.giverName ? ` · ${r.giverName}` : ""}
                  {r.note ? ` · ${r.note}` : ""}
                </p>
              </div>
              {canManage && (
                <>
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
                      {pending ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        "Confirm"
                      )}
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
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Record / edit dialog */}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
          aria-describedby={undefined}
        >
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

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

              {/* Receipt: only for a new gift tied to a member, when the church
                  has receipts turned on. */}
              {receiptsEnabled && !form.id && form.memberId !== NONE && (
                <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
                  <span>
                    <span className="block text-sm font-semibold">
                      Send receipt &amp; blessing
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      Email/SMS the giver to acknowledge this gift (per Settings →
                      Giving).
                    </span>
                  </span>
                  <Switch
                    checked={form.sendReceipt}
                    onCheckedChange={(v) => set({ sendReceipt: v })}
                  />
                </label>
              )}

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

      <CategorySetupDialog open={setupOpen} onOpenChange={setSetupOpen} />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  className,
  valueClassName,
}: {
  label: string;
  value: string;
  sub: string;
  icon: LucideIcon;
  accent?: boolean;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border p-4 shadow-sm",
        accent
          ? "from-primary border-transparent bg-gradient-to-br to-violet-500 text-white"
          : "bg-card",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "text-xs font-semibold sm:text-sm",
            accent ? "text-white/80" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg",
            accent ? "bg-white/20 text-white" : "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
      <p
        className={cn(
          "mt-2 leading-tight font-extrabold tabular-nums break-words",
          valueClassName,
        )}
      >
        {value}
      </p>
      <p
        className={cn(
          "mt-0.5 text-[11px] sm:text-xs",
          accent ? "text-white/70" : "text-muted-foreground",
        )}
      >
        {sub}
      </p>
    </div>
  );
}

const SUGGESTED_CATEGORIES = [
  "Tithe",
  "Offering",
  "Thanksgiving",
  "Building Project",
];

function CategorySetupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(
    new Set(SUGGESTED_CATEGORIES),
  );
  const [custom, setCustom] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  // Reset to the defaults each time the dialog opens.
  const [seen, setSeen] = useState(false);
  if (open && !seen) {
    setSelected(new Set(SUGGESTED_CATEGORIES));
    setCustom([]);
    setDraft("");
    setSeen(true);
  }
  if (!open && seen) setSeen(false);

  const all = [...SUGGESTED_CATEGORIES, ...custom];

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function addCustom() {
    const name = draft.trim();
    if (!name) return;
    if (all.some((a) => a.toLowerCase() === name.toLowerCase())) {
      setDraft("");
      return;
    }
    setCustom((c) => [...c, name]);
    setSelected((prev) => new Set(prev).add(name));
    setDraft("");
  }

  function removeCustom(name: string) {
    setCustom((c) => c.filter((x) => x !== name));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }

  function confirm() {
    const names = [...selected];
    if (names.length === 0) return;
    startTransition(async () => {
      const res = await createGivingCategories(names);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Added ${names.length} categor${names.length === 1 ? "y" : "ies"}`,
      );
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>Set up giving categories</DialogTitle>
        </DialogHeader>

        <p className="text-muted-foreground text-sm">
          Pick the types of giving your church receives, or add your own. You
          can change these anytime in Settings → Giving.
        </p>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {all.map((name) => {
              const on = selected.has(name);
              const isCustom = custom.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggle(name)}
                  className={
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors " +
                    (on
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent")
                  }
                >
                  {on ? <Check className="size-4" /> : <Plus className="size-4" />}
                  {name}
                  {isCustom && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCustom(name);
                      }}
                      className="ml-0.5 opacity-70 hover:opacity-100"
                    >
                      <X className="size-3.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add your own (e.g. Seed, First Fruit)"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={addCustom}
              disabled={!draft.trim()}
            >
              Add
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={confirm} disabled={pending || selected.size === 0}>
            {pending && <Loader2 className="animate-spin" />}
            Add {selected.size > 0 ? selected.size : ""} categor
            {selected.size === 1 ? "y" : "ies"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
