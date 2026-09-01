"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  HandCoins,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  deletePledge,
  deleteProject,
  savePledge,
  saveProject,
  setPledgeStatus,
  type PledgeInput,
} from "@/app/(app)/giving/projects/actions";
import { recordGiving } from "@/app/(app)/giving/actions";
import type { PledgeRow, ProjectDetail as Detail } from "@/lib/projects";
import { CADENCES, cadenceLabel } from "@/lib/projects-shared";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ProgressBar } from "@/components/giving/progress-bar";
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

const NONE = "__none__";
const METHODS = ["cash", "transfer", "card", "cheque", "online", "other"] as const;
const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  transfer: "Transfer",
  card: "Card",
  cheque: "Cheque",
  online: "Online",
  other: "Other",
};

type Member = { id: string; name: string };

export function ProjectDetail({
  project: p,
  canManage,
  currency,
  today,
  members,
  receiptsEnabled,
}: {
  project: Detail;
  canManage: boolean;
  currency: string;
  today: string;
  members: Member[];
  receiptsEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pledgeOpen, setPledgeOpen] = useState(false);
  const [payFor, setPayFor] = useState<PledgeRow | null>(null);
  const [editProjectOpen, setEditProjectOpen] = useState(false);

  const goal = p.targetAmount ?? (p.pledged || 0);
  const outstandingTotal = useMemo(
    () =>
      p.pledges
        .filter((pl) => pl.status !== "cancelled")
        .reduce((a, pl) => a + Math.max(0, pl.amount - pl.paid), 0),
    [p.pledges],
  );

  return (
    <div className="space-y-4">
      {/* Header + summary */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{p.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm capitalize">
            {p.status}
            {p.description ? ` · ${p.description}` : ""}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditProjectOpen(true)}>
              <Pencil className="size-4" /> Edit
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="space-y-3 py-5">
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Raised" value={formatMoney(p.raised, currency)} accent />
            <Stat label="Pledged" value={formatMoney(p.pledged, currency)} />
            <Stat
              label={p.targetAmount ? "Target" : "Outstanding"}
              value={formatMoney(p.targetAmount ?? outstandingTotal, currency)}
            />
          </div>
          <ProgressBar value={p.raised} target={goal > 0 ? goal : null} currency={currency} />
        </CardContent>
      </Card>

      {/* Pledges */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-lg">
            Pledges{p.pledges.length ? ` (${p.pledges.length})` : ""}
          </CardTitle>
          {canManage && p.status === "active" && (
            <Button variant="outline" size="sm" onClick={() => setPledgeOpen(true)}>
              <Plus className="size-4" /> Add pledge
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {p.pledges.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No pledges yet. Add one to start tracking payments toward it.
            </p>
          ) : (
            p.pledges.map((pl) => (
              <PledgeCard
                key={pl.id}
                pledge={pl}
                currency={currency}
                canManage={canManage}
                onPay={() => setPayFor(pl)}
                pending={pending}
                onStatus={(status) =>
                  start(async () => {
                    const res = await setPledgeStatus(pl.id, status);
                    if (!res.ok) return void toast.error(res.error);
                    toast.success("Pledge updated");
                    router.refresh();
                  })
                }
                onDelete={() =>
                  start(async () => {
                    const res = await deletePledge(pl.id);
                    if (!res.ok) return void toast.error(res.error);
                    toast.success("Pledge removed (payments kept)");
                    router.refresh();
                  })
                }
              />
            ))
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={() => {
            if (
              !confirm(
                `Delete the "${p.name}" project? Its pledges are removed but recorded payments are kept (just unlinked).`,
              )
            )
              return;
            start(async () => {
              const res = await deleteProject(p.id);
              if (!res.ok) return void toast.error(res.error);
              toast.success("Project deleted");
              router.push("/giving/projects");
            });
          }}
        >
          <Trash2 className="size-4" /> Delete project
        </Button>
      )}

      {/* Dialogs */}
      {pledgeOpen && (
        <PledgeDialog
          projectId={p.id}
          members={members}
          onClose={() => setPledgeOpen(false)}
          onSaved={() => {
            setPledgeOpen(false);
            router.refresh();
          }}
        />
      )}
      {payFor && (
        <PaymentDialog
          pledge={payFor}
          projectId={p.id}
          currency={currency}
          today={today}
          receiptsEnabled={receiptsEnabled}
          onClose={() => setPayFor(null)}
          onSaved={() => {
            setPayFor(null);
            router.refresh();
          }}
        />
      )}
      {editProjectOpen && (
        <EditProjectDialog
          project={p}
          onClose={() => setEditProjectOpen(false)}
          onSaved={() => {
            setEditProjectOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border p-2">
      <p className={cn("truncate text-lg font-extrabold tabular-nums", accent && "text-primary")}>
        {value}
      </p>
      <p className="text-muted-foreground text-xs">{label}</p>
    </div>
  );
}

function PledgeCard({
  pledge: pl,
  currency,
  canManage,
  onPay,
  onStatus,
  onDelete,
  pending,
}: {
  pledge: PledgeRow;
  currency: string;
  canManage: boolean;
  onPay: () => void;
  onStatus: (s: "active" | "completed" | "cancelled") => void;
  onDelete: () => void;
  pending: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const outstanding = Math.max(0, pl.amount - pl.paid);
  const done = pl.status === "completed" || pl.paid >= pl.amount;

  return (
    <div className="rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold">{pl.name}</span>
        {pl.status === "cancelled" ? (
          <Badge variant="outline">Cancelled</Badge>
        ) : done ? (
          <Badge variant="success">Fulfilled</Badge>
        ) : (
          <Badge variant="secondary">{cadenceLabel(pl.cadence, pl.cadenceLabel)}</Badge>
        )}
      </div>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {formatMoney(pl.paid, currency)} of {formatMoney(pl.amount, currency)}
        {outstanding > 0 && pl.status !== "cancelled"
          ? ` · ${formatMoney(outstanding, currency)} outstanding`
          : ""}
        {pl.installmentAmount
          ? ` · ${formatMoney(pl.installmentAmount, currency)}/${shortCadence(pl.cadence, pl.cadenceLabel)}`
          : ""}
      </p>
      <div className="mt-2">
        <ProgressBar
          value={pl.paid}
          target={pl.amount}
          currency={currency}
          showPct={false}
        />
      </div>
      {canManage && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {pl.status !== "cancelled" && !done && (
            <Button size="sm" onClick={onPay} disabled={pending}>
              <HandCoins className="size-4" /> Record payment
            </Button>
          )}
          <div className="relative ml-auto">
            <Button variant="ghost" size="icon" onClick={() => setMenu((v) => !v)}>
              <MoreVertical className="size-4" />
            </Button>
            {menu && (
              <div
                className="bg-popover absolute right-0 z-10 mt-1 w-44 rounded-lg border p-1 shadow-md"
                onMouseLeave={() => setMenu(false)}
              >
                {done ? (
                  <MenuItem onClick={() => { setMenu(false); onStatus("active"); }}>
                    Reopen pledge
                  </MenuItem>
                ) : (
                  <MenuItem onClick={() => { setMenu(false); onStatus("completed"); }}>
                    <Check className="size-4" /> Mark fulfilled
                  </MenuItem>
                )}
                {pl.status !== "cancelled" ? (
                  <MenuItem onClick={() => { setMenu(false); onStatus("cancelled"); }}>
                    <X className="size-4" /> Cancel pledge
                  </MenuItem>
                ) : (
                  <MenuItem onClick={() => { setMenu(false); onStatus("active"); }}>
                    Reactivate
                  </MenuItem>
                )}
                <MenuItem
                  destructive
                  onClick={() => {
                    setMenu(false);
                    if (confirm("Remove this pledge? Payments already recorded are kept.")) onDelete();
                  }}
                >
                  <Trash2 className="size-4" /> Delete pledge
                </MenuItem>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  destructive,
}: {
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
        destructive && "text-destructive",
      )}
    >
      {children}
    </button>
  );
}

function shortCadence(cadence: PledgeRow["cadence"], custom: string | null): string {
  const map: Record<string, string> = {
    weekly: "wk",
    monthly: "mo",
    quarterly: "qtr",
    yearly: "yr",
    one_time: "once",
  };
  return cadence === "custom" ? (custom?.trim() || "period") : map[cadence] ?? "period";
}

/* ------------------------------- Dialogs ------------------------------- */

function PledgeDialog({
  projectId,
  members,
  onClose,
  onSaved,
}: {
  projectId: string;
  members: Member[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [memberId, setMemberId] = useState(NONE);
  const [giverName, setGiverName] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<PledgeInput["cadence"]>("one_time");
  const [cadenceLabelText, setCadenceLabelText] = useState("");
  const [installment, setInstallment] = useState("");
  const [startDate, setStartDate] = useState("");
  const [note, setNote] = useState("");

  function save() {
    start(async () => {
      const res = await savePledge({
        projectId,
        memberId: memberId === NONE ? "" : memberId,
        giverName: memberId === NONE ? giverName : "",
        amount,
        cadence,
        cadenceLabel: cadence === "custom" ? cadenceLabelText : "",
        installmentAmount: installment,
        startDate,
        note,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Pledge added");
      onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Add pledge</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Pledged by</Label>
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a member" />
              </SelectTrigger>
              <SelectContent
                className="max-h-72"
                searchPlaceholder="Search members…"
                emptyMessage="No member by that name"
              >
                <SelectItem value={NONE}>Someone not in the list…</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {memberId === NONE && (
              <Input
                value={giverName}
                onChange={(e) => setGiverName(e.target.value)}
                placeholder="Giver's name"
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pl-amount">Pledge amount</Label>
              <Input
                id="pl-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="50,000"
              />
            </div>
            <div className="space-y-2">
              <Label>How they&apos;ll give</Label>
              <Select value={cadence} onValueChange={(v) => setCadence(v as PledgeInput["cadence"])}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CADENCES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {cadence === "custom" && (
            <div className="space-y-2">
              <Label htmlFor="pl-cl">Custom frequency label</Label>
              <Input
                id="pl-cl"
                value={cadenceLabelText}
                onChange={(e) => setCadenceLabelText(e.target.value)}
                placeholder="e.g. every service, fortnightly"
              />
            </div>
          )}
          {cadence !== "one_time" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pl-inst">Amount each time (optional)</Label>
                <Input
                  id="pl-inst"
                  inputMode="decimal"
                  value={installment}
                  onChange={(e) => setInstallment(e.target.value)}
                  placeholder="5,000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pl-start">Starting</Label>
                <Input
                  id="pl-start"
                  type="date"
                  className="h-11"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="pl-note">Note</Label>
            <Textarea id="pl-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !amount.trim()}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Add pledge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({
  pledge: pl,
  projectId,
  currency,
  today,
  receiptsEnabled,
  onClose,
  onSaved,
}: {
  pledge: PledgeRow;
  projectId: string;
  currency: string;
  today: string;
  receiptsEnabled: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const outstanding = Math.max(0, pl.amount - pl.paid);
  const [amount, setAmount] = useState(
    pl.installmentAmount
      ? String(pl.installmentAmount)
      : outstanding
        ? String(outstanding)
        : "",
  );
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<string>(NONE);
  const [sendReceipt, setSendReceipt] = useState(receiptsEnabled && !!pl.memberId);

  function save() {
    start(async () => {
      const res = await recordGiving({
        amount,
        date,
        categoryId: "",
        memberId: pl.memberId ?? "",
        giverName: pl.memberId ? "" : (pl.giverName ?? pl.name),
        method: method === NONE ? "" : method,
        note: "",
        projectId,
        pledgeId: pl.id,
        sendReceipt: !!pl.memberId && sendReceipt,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Payment recorded");
      onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Record payment · {pl.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            {formatMoney(pl.paid, currency)} of {formatMoney(pl.amount, currency)} paid
            {outstanding > 0 ? ` · ${formatMoney(outstanding, currency)} outstanding` : ""}.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pay-amt">Amount</Label>
              <Input
                id="pay-amt"
                inputMode="decimal"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-date">Date</Label>
              <Input
                id="pay-date"
                type="date"
                className="h-11"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {METHOD_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {receiptsEnabled && pl.memberId && (
            <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <span className="text-sm font-semibold">Send receipt &amp; blessing</span>
              <Switch checked={sendReceipt} onCheckedChange={setSendReceipt} />
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !amount.trim()}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditProjectDialog({
  project: p,
  onClose,
  onSaved,
}: {
  project: Detail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [name, setName] = useState(p.name);
  const [description, setDescription] = useState(p.description ?? "");
  const [targetAmount, setTargetAmount] = useState(
    p.targetAmount != null ? String(p.targetAmount) : "",
  );
  const [status, setStatus] = useState(p.status);

  function save() {
    start(async () => {
      const res = await saveProject({
        id: p.id,
        name,
        description,
        targetAmount,
        status,
        startDate: p.startDate ?? "",
        endDate: p.endDate ?? "",
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Project saved");
      onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="ep-name">Name</Label>
            <Input id="ep-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ep-target">Target amount (optional)</Label>
            <Input
              id="ep-target"
              inputMode="decimal"
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as Detail["status"])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ep-desc">Description</Label>
            <Textarea
              id="ep-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !name.trim()}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
