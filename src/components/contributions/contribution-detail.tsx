"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Eye,
  HardDrive,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Share2,
  Target,
  Trash2,
  Undo2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteContribution,
  deleteEntry,
  deletePayout,
  rejectEntry,
  releaseProof,
  removeContributor,
  reopenEntry,
  setContributionStatus,
  voteOnEntry,
  voteOnPayout,
  withdrawVote,
} from "@/app/(app)/contributions/actions";
import type {
  ContributionDetail as Detail,
  ContributorRow,
  EntryRow,
  PayoutRow,
} from "@/lib/contributions";
import {
  contributionPath,
  dueLabel,
  METHOD_LABEL,
  PAYOUT_KIND_LABEL,
  peopleStillNeeded,
} from "@/lib/contributions-shared";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { formatBytes } from "@/lib/storage-bytes";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EntryStatusBadge,
  Figure,
  GoalReachedBanner,
  PayoutStatusBadge,
  PotMeter,
  PotStatusBadge,
} from "@/components/contributions/pieces";
import { EntryDialog } from "@/components/contributions/entry-dialog";
import { PayoutDialog } from "@/components/contributions/payout-dialog";
import {
  PasteListDialog,
  PersonDialog,
} from "@/components/contributions/people-dialogs";
import { PotFormDialog, type PotFormValues } from "@/components/contributions/pot-form-dialog";
import { SharePanel } from "@/components/contributions/share-panel";
import { useT } from "@/components/i18n-provider";

type Tab = "ledger" | "people" | "out" | "share";

export function ContributionDetail({
  pot,
  currency,
  today,
  canManage,
  canPostToFinance,
  siteUrl,
  members,
  groups,
  financeAccounts,
  currentUserId,
}: {
  pot: Detail;
  currency: string;
  today: string;
  canManage: boolean;
  canPostToFinance: boolean;
  siteUrl: string;
  members: { id: string; name: string }[];
  groups: { id: string; name: string; type: string }[];
  financeAccounts: { id: string; name: string }[];
  currentUserId: string;
}) {
  const t = useT();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("ledger");
  const [entryOpen, setEntryOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<EntryRow | null>(null);
  const [presetPerson, setPresetPerson] = useState<string | null>(null);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [editingPayout, setEditingPayout] = useState<PayoutRow | null>(null);
  const [personOpen, setPersonOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<ContributorRow | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const due = dueLabel(pot.dueDate, today);
  const overdue = !!pot.dueDate && pot.dueDate < today && pot.status === "open";
  const remaining = pot.target ? Math.max(0, pot.target - pot.raised) : 0;
  const moreNeeded = peopleStillNeeded(remaining, pot.perPersonAmount);
  const publicUrl = `${siteUrl}${contributionPath(pot.slug)}`;

  const tabs: { id: Tab; label: string; icon: typeof Users; count?: number }[] = [
    { id: "ledger", label: t("contributions.tabLedger"), icon: ArrowDownToLine, count: pot.entries.length },
    { id: "people", label: t("contributions.tabPeople"), icon: Users, count: pot.contributors.length },
    { id: "out", label: t("contributions.tabMoneyOut"), icon: Target, count: pot.payouts.length },
    { id: "share", label: t("contributions.tabShare"), icon: Share2 },
  ];

  const awaiting = pot.entries.filter(
    (e) => e.status === "pending" || e.status === "disputed",
  ).length;
  const pendingOutCount = pot.payouts.filter((p) => p.status === "pending").length;

  return (
    <div className="space-y-5">
      {/* ---------- Header ---------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight lg:text-3xl">
              {pot.title}
            </h1>
            <PotStatusBadge status={pot.status} />
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {[
              pot.groupName,
              pot.honoureeName
                ? t("contributions.forHonouree", { name: pot.honoureeName })
                : null,
              pot.createdByName
                ? t("contributions.createdBy", { name: pot.createdByName })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {pot.purpose && (
            <p className="mt-2 max-w-2xl text-sm whitespace-pre-wrap">{pot.purpose}</p>
          )}
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            {pot.status === "draft" && (
              <Button
                onClick={() => void changeStatus("open")}
              >
                {t("contributions.startCollecting")}
              </Button>
            )}
            {pot.status === "open" && (
              <Button onClick={() => setEntryOpen(true)}>
                <Plus className="size-4" aria-hidden /> {t("contributions.recordPayment")}
              </Button>
            )}
            <LifecycleMenu
              pot={pot}
              onEdit={() => setSettingsOpen(true)}
              onStatus={(s) => void changeStatus(s)}
              onDelete={() => void remove()}
            />
          </div>
        )}
      </div>

      {/* ---------- Goal reached ---------- */}
      {pot.goalReachedAt && pot.target && (
        <GoalReachedBanner target={pot.target} currency={currency} />
      )}

      {/* ---------- Figures ---------- */}
      <div className="bg-card rounded-2xl border p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure
            label={t("contributions.raised")}
            value={formatMoney(pot.raised, currency)}
            tone="accent"
          />
          <Figure
            label={t("contributions.awaitingConfirmation")}
            value={formatMoney(pot.pendingIn + pot.disputedIn, currency)}
            hint={
              pot.disputedIn > 0
                ? `${formatMoneyCompact(pot.disputedIn, currency)} disputed`
                : undefined
            }
            tone={pot.disputedIn > 0 ? "warning" : "muted"}
          />
          <Figure
            label={t("contributions.paidOut")}
            value={formatMoney(pot.paidOut, currency)}
            hint={
              pot.pendingOut > 0
                ? `${formatMoneyCompact(pot.pendingOut, currency)} awaiting approval`
                : undefined
            }
          />
          <Figure
            label={t("contributions.balance")}
            value={formatMoney(pot.balance, currency)}
          />
        </div>

        <PotMeter
          raised={pot.raised}
          pending={pot.pendingIn + pot.disputedIn}
          target={pot.target}
          currency={currency}
          className="mt-4"
          size="lg"
        />

        <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>
            <Users className="mr-1 inline size-3.5" aria-hidden />
            {pot.contributors.filter((c) => c.paid > 0).length} of{" "}
            {pot.contributors.length} {t("contributions.givers").toLowerCase()}
          </span>
          {pot.perPersonAmount != null && (
            <span>
              {t("contributions.perPerson")}: {formatMoney(pot.perPersonAmount, currency)}
            </span>
          )}
          {remaining > 0 && (
            <span className="font-medium">
              {t("contributions.toGo", { amount: formatMoney(remaining, currency) })}
              {moreNeeded
                ? ` — ${t("contributions.aboutPeopleAt", {
                    count: moreNeeded,
                    amount: formatMoneyCompact(pot.perPersonAmount ?? 0, currency),
                  })}`
                : ""}
            </span>
          )}
          {due && (
            <span className={cn(overdue && "text-destructive font-semibold")}>
              {t("contributions.publicDeadline")}: {due}
            </span>
          )}
        </div>
      </div>

      {/* ---------- Things waiting ---------- */}
      {(awaiting > 0 || pendingOutCount > 0) && (
        <div className="bg-warning/10 border-warning/30 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border p-3 text-sm">
          <AlertTriangle className="text-warning size-4 shrink-0" aria-hidden />
          <span className="font-medium">
            {awaiting > 0 &&
              `${t("contributions.payments", { count: awaiting })} ${t("contributions.toConfirm")}`}
            {awaiting > 0 && pendingOutCount > 0 && " · "}
            {pendingOutCount > 0 &&
              `${t("contributions.payments", { count: pendingOutCount })} ${t("contributions.outAwaitingApproval")}`}
          </span>
        </div>
      )}

      {/* ---------- Tabs ---------- */}
      <div className="bg-muted inline-flex flex-wrap gap-1 rounded-xl p-1">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setTab(x.id)}
            aria-current={tab === x.id ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors sm:px-4",
              tab === x.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <x.icon className="size-4" aria-hidden />
            {x.label}
            {x.count !== undefined && x.count > 0 && (
              <span className="bg-primary/10 text-primary rounded-full px-1.5 text-xs font-bold">
                {x.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "ledger" && (
        <LedgerPanel
          pot={pot}
          currency={currency}
          canManage={canManage}
          currentUserId={currentUserId}
          onRecord={() => {
            setEditingEntry(null);
            setPresetPerson(null);
            setEntryOpen(true);
          }}
          onEdit={(e) => {
            setEditingEntry(e);
            setEntryOpen(true);
          }}
        />
      )}

      {tab === "people" && (
        <PeoplePanel
          pot={pot}
          currency={currency}
          canManage={canManage}
          onAdd={() => {
            setEditingPerson(null);
            setPersonOpen(true);
          }}
          onPaste={() => setPasteOpen(true)}
          onEdit={(c) => {
            setEditingPerson(c);
            setPersonOpen(true);
          }}
          onRecordFor={(c) => {
            setEditingEntry(null);
            setPresetPerson(c.id);
            setEntryOpen(true);
          }}
        />
      )}

      {tab === "out" && (
        <PayoutsPanel
          pot={pot}
          currency={currency}
          canManage={canManage}
          currentUserId={currentUserId}
          onRecord={() => {
            setEditingPayout(null);
            setPayoutOpen(true);
          }}
          onEdit={(p) => {
            setEditingPayout(p);
            setPayoutOpen(true);
          }}
          financeAccounts={financeAccounts}
          canPostToFinance={canPostToFinance}
        />
      )}

      {tab === "share" && (
        <SharePanel
          pot={pot}
          currency={currency}
          today={today}
          url={publicUrl}
          canManage={canManage}
          onPublish={() => void changeStatus("open")}
        />
      )}

      {/* ---------- Receipts footprint ---------- */}
      {pot.proofCount > 0 && (
        <p className="text-muted-foreground flex items-start gap-2 text-xs">
          <HardDrive className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {t(
              pot.proofCount === 1
                ? "contributions.receiptsHeld"
                : "contributions.receiptsHeldPlural",
              { count: pot.proofCount, size: formatBytes(pot.proofBytes) },
            )}
            . {pot.keepProofs ? "Kept indefinitely." : t("contributions.receiptsBlurb")}
          </span>
        </p>
      )}

      {/* ---------- Dialogs ---------- */}
      {canManage && (
        <>
          <EntryDialog
            open={entryOpen}
            onOpenChange={(next) => {
              setEntryOpen(next);
              if (!next) {
                setEditingEntry(null);
                setPresetPerson(null);
              }
            }}
            potId={pot.id}
            currency={currency}
            today={today}
            contributors={pot.contributors}
            members={members}
            askForProof
            editing={editingEntry}
            presetContributorId={presetPerson}
          />
          <PayoutDialog
            open={payoutOpen}
            onOpenChange={(next) => {
              setPayoutOpen(next);
              if (!next) setEditingPayout(null);
            }}
            potId={pot.id}
            currency={currency}
            today={today}
            available={pot.balance - pot.pendingOut}
            approvalsRequired={pot.payoutApprovalsRequired}
            financeAccounts={financeAccounts}
            canPostToFinance={canPostToFinance}
            editing={editingPayout}
          />
          <PersonDialog
            open={personOpen}
            onOpenChange={(next) => {
              setPersonOpen(next);
              if (!next) setEditingPerson(null);
            }}
            potId={pot.id}
            currency={currency}
            members={members}
            editing={editingPerson}
          />
          <PasteListDialog
            open={pasteOpen}
            onOpenChange={setPasteOpen}
            potId={pot.id}
          />
          <PotFormDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            initial={toFormValues(pot)}
            currency={currency}
            groups={groups}
            members={members}
          />
        </>
      )}
    </div>
  );

  async function changeStatus(status: "draft" | "open" | "closed" | "settled") {
    const res = await setContributionStatus(pot.id, status);
    if (res.ok) {
      toast.success(t("contributions.saved"));
      router.refresh();
    } else toast.error(res.error);
  }

  async function remove() {
    if (!confirm(t("contributions.confirmDeletePot", { title: pot.title }))) return;
    const res = await deleteContribution(pot.id);
    if (res.ok) {
      toast.success(t("contributions.deleted"));
      router.push("/contributions");
    } else toast.error(res.error);
  }
}

function toFormValues(pot: Detail): PotFormValues {
  return {
    id: pot.id,
    title: pot.title,
    purpose: pot.purpose ?? "",
    kind: pot.kind,
    groupId: pot.groupId,
    targetAmount: pot.targetAmount != null ? String(pot.targetAmount) : "",
    perPersonAmount: pot.perPersonAmount != null ? String(pot.perPersonAmount) : "",
    payInstructions: pot.payInstructions ?? "",
    honoureeMemberId: pot.honoureeMemberId,
    honoureeName: pot.honoureeName ?? "",
    startDate: pot.startDate ?? "",
    dueDate: pot.dueDate ?? "",
    visibility: pot.visibility,
    showOutstanding: pot.showOutstanding,
    showPayouts: pot.showPayouts,
    showNotes: pot.showNotes,
    allowSelfReport: pot.allowSelfReport,
    askForProof: pot.askForProof,
    confirmationsRequired: pot.confirmationsRequired,
    payoutApprovalsRequired: pot.payoutApprovalsRequired,
    keepProofs: pot.keepProofs,
  };
}

/* ============================================================
 * Lifecycle menu
 * ========================================================== */

function LifecycleMenu({
  pot,
  onEdit,
  onStatus,
  onDelete,
}: {
  pot: Detail;
  onEdit: () => void;
  onStatus: (s: "draft" | "open" | "closed" | "settled") => void;
  onDelete: () => void;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={t("contributions.moreActions")}>
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="size-4" aria-hidden /> {t("contributions.editCollection")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {pot.status === "open" && (
          <DropdownMenuItem onClick={() => onStatus("closed")}>
            {t("contributions.closeCollection")}
          </DropdownMenuItem>
        )}
        {(pot.status === "closed" || pot.status === "settled") && (
          <DropdownMenuItem onClick={() => onStatus("open")}>
            {t("contributions.reopenCollection")}
          </DropdownMenuItem>
        )}
        {pot.status === "closed" && (
          <DropdownMenuItem onClick={() => onStatus("settled")}>
            {t("contributions.markSettled")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="size-4" aria-hidden /> {t("contributions.deleteCollection")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ============================================================
 * Payments
 * ========================================================== */

function LedgerPanel({
  pot,
  currency,
  canManage,
  currentUserId,
  onRecord,
  onEdit,
}: {
  pot: Detail;
  currency: string;
  canManage: boolean;
  currentUserId: string;
  onRecord: () => void;
  onEdit: (e: EntryRow) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<"all" | "awaiting" | "confirmed">("all");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pot.entries.filter((e) => {
      if (only === "awaiting" && e.status !== "pending" && e.status !== "disputed")
        return false;
      if (only === "confirmed" && e.status !== "confirmed") return false;
      if (!q) return true;
      return (
        e.contributorName.toLowerCase().includes(q) ||
        (e.reference ?? "").toLowerCase().includes(q) ||
        (e.note ?? "").toLowerCase().includes(q) ||
        String(e.amount).includes(q)
      );
    });
  }, [pot.entries, query, only]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("contributions.searchPayments")}
            aria-label={t("contributions.searchPayments")}
            className="pl-9"
          />
        </div>
        <div className="bg-muted inline-flex gap-1 rounded-lg p-1">
          {(
            [
              ["all", t("contributions.allStatuses")],
              ["awaiting", t("contributions.awaitingConfirmation")],
              ["confirmed", t("contributions.confirmed")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setOnly(id)}
              aria-pressed={only === id}
              className={cn(
                "min-h-9 rounded-md px-2.5 text-xs font-semibold transition-colors",
                only === id
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`/contributions/${pot.id}/export`}>
              <Download className="size-4" aria-hidden /> {t("contributions.exportCsv")}
            </a>
          </Button>
          {canManage && (
            <Button size="sm" onClick={onRecord}>
              <Plus className="size-4" aria-hidden /> {t("contributions.recordPayment")}
            </Button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="bg-card text-muted-foreground rounded-2xl border p-8 text-center text-sm">
          {pot.entries.length === 0
            ? t("contributions.noPayments")
            : t("contributions.notMatchingThat")}
        </p>
      ) : (
        <div className="bg-card overflow-hidden rounded-2xl border">
          <ScrollableTable
            stickyFirstColumn
            label={t("contributions.tabLedger")}
            hint={t("common.scrollForMore")}
          >
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="px-3 py-2.5 text-left font-bold">
                    {t("contributions.colWho")}
                  </th>
                  <th className="px-3 py-2.5 text-right font-bold">
                    {t("common.amount")}
                  </th>
                  <th className="px-3 py-2.5 text-left font-bold">
                    {t("contributions.colWhen")}
                  </th>
                  <th className="px-3 py-2.5 text-left font-bold">
                    {t("contributions.colHow")}
                  </th>
                  <th className="px-3 py-2.5 text-left font-bold">
                    {t("contributions.colStanding")}
                  </th>
                  <th className="px-3 py-2.5 text-right font-bold">
                    <span className="sr-only">{t("contributions.colActions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <EntryLine
                    key={e.id}
                    entry={e}
                    pot={pot}
                    currency={currency}
                    canManage={canManage}
                    currentUserId={currentUserId}
                    onEdit={() => onEdit(e)}
                  />
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        </div>
      )}
    </div>
  );
}

function EntryLine({
  entry: e,
  pot,
  currency,
  canManage,
  currentUserId,
  onEdit,
}: {
  entry: EntryRow;
  pot: Detail;
  currency: string;
  canManage: boolean;
  currentUserId: string;
  onEdit: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [disputing, setDisputing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);

  const myVote = e.approvals.find((a) => a.userId === currentUserId);
  const needed = Math.max(
    e.disputes > 0 ? 2 : 1,
    pot.confirmationsRequired,
  );

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(done);
        setDisputing(false);
        setRejecting(false);
        setReason("");
        router.refresh();
      } else toast.error(res.error ?? "That didn't work.");
    });
  }

  return (
    <>
      <tr className="hover:bg-muted/30 border-t align-top">
        <td className="px-3 py-3">
          <button
            type="button"
            onClick={() => setOpen((s) => !s)}
            aria-expanded={open}
            className="text-left"
          >
            <span className="flex items-center gap-1.5 font-semibold">
              {e.isAnonymous ? (
                <span className="text-muted-foreground italic">
                  {e.contributorName}{" "}
                  <span className="text-[10px] font-bold uppercase">
                    {t("contributions.anonymousTag")}
                  </span>
                </span>
              ) : (
                e.contributorName
              )}
              <ChevronDown
                className={cn(
                  "text-muted-foreground size-3.5 transition-transform",
                  open && "rotate-180",
                )}
                aria-hidden
              />
            </span>
          </button>
          {e.source === "self" && (
            <span className="text-muted-foreground mt-0.5 block text-xs">
              {t("contributions.selfReported")}
            </span>
          )}
        </td>
        <td className="px-3 py-3 text-right font-bold tabular-nums">
          {formatMoney(e.amount, currency)}
        </td>
        <td className="text-muted-foreground px-3 py-3 whitespace-nowrap">{e.paidOn}</td>
        <td className="text-muted-foreground px-3 py-3">
          {e.method ? METHOD_LABEL[e.method] : "—"}
          {e.reference && (
            <span className="block truncate text-xs">{e.reference}</span>
          )}
        </td>
        <td className="px-3 py-3">
          <EntryStatusBadge status={e.status} short />
          {e.status !== "confirmed" && e.status !== "rejected" && (
            <span className="text-muted-foreground mt-0.5 block text-xs tabular-nums">
              {t("contributions.needsConfirmations", {
                have: e.confirmations,
                need: needed,
              })}
            </span>
          )}
        </td>
        <td className="px-3 py-3 text-right">
          {canManage && (
            <div className="flex items-center justify-end gap-1">
              {e.status !== "rejected" && !myVote && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    act(
                      () => voteOnEntry({ entryId: e.id, decision: "confirm" }),
                      t("contributions.confirmed"),
                    )
                  }
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Check className="size-4" aria-hidden />
                  )}
                  {t("contributions.confirm")}
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("contributions.entryActions", {
                      name: e.contributorName,
                    })}
                  >
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={onEdit}>
                    <Pencil className="size-4" aria-hidden /> {t("contributions.editPayment")}
                  </DropdownMenuItem>
                  {myVote && (
                    <DropdownMenuItem
                      onClick={() =>
                        act(
                        () => withdrawVote(e.id),
                        t("contributions.confirmationWithdrawn"),
                      )
                      }
                    >
                      <Undo2 className="size-4" aria-hidden />{" "}
                      {t("contributions.withdrawMyConfirmation")}
                    </DropdownMenuItem>
                  )}
                  {myVote?.decision !== "dispute" && e.status !== "rejected" && (
                    <DropdownMenuItem onClick={() => setDisputing(true)}>
                      <AlertTriangle className="size-4" aria-hidden />{" "}
                      {t("contributions.dispute")}
                    </DropdownMenuItem>
                  )}
                  {e.proofUrl && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <a href={e.proofUrl} target="_blank" rel="noopener noreferrer">
                          <Eye className="size-4" aria-hidden />{" "}
                          {t("contributions.viewProof")}
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          act(
                            () => releaseProof({ entryId: e.id }),
                            t("contributions.proofReleasedToast"),
                          )
                        }
                      >
                        <HardDrive className="size-4" aria-hidden />{" "}
                        {t("contributions.releaseProof")}
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  {e.status === "rejected" ? (
                    <DropdownMenuItem
                      onClick={() =>
                        act(() => reopenEntry(e.id), t("contributions.reopened"))
                      }
                    >
                      <Undo2 className="size-4" aria-hidden /> {t("contributions.reopen")}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => setRejecting(true)}>
                      <X className="size-4" aria-hidden />{" "}
                      {t("contributions.markNotCounted")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                      if (!confirm(t("contributions.confirmDeleteEntry"))) return;
                      act(() => deleteEntry(e.id), t("contributions.deleted"));
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden /> {t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </td>
      </tr>

      {open && (
        <tr className="bg-muted/20 border-t">
          <td colSpan={6} className="px-3 py-3">
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              {e.note && (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground font-bold uppercase">
                    {t("contributions.noteLabel")}
                  </dt>
                  <dd className="whitespace-pre-wrap">{e.note}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground font-bold uppercase">
                  {t("contributions.whoRecorded")}
                </dt>
                <dd>
                  {e.recordedByName ?? "—"}
                  {e.source === "self" ? ` (${t("contributions.theGiver")})` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground font-bold uppercase">
                  {t("contributions.proofLabel")}
                </dt>
                <dd>
                  {e.proofUrl ? (
                    <a
                      href={e.proofUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {t("contributions.viewProof")}
                      <ExternalLink className="ml-1 inline size-3" aria-hidden />
                    </a>
                  ) : e.proofReleasedAt ? (
                    t("contributions.proofReleased", {
                      date: e.proofReleasedAt.slice(0, 10),
                    })
                  ) : (
                    t("contributions.noneAttached")
                  )}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground font-bold uppercase">
                  {t("contributions.whoChecked")}
                </dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {e.approvals.length === 0 ? (
                    <span className="text-muted-foreground">
                      {t("contributions.nobodyYet")}
                    </span>
                  ) : (
                    e.approvals.map((a) => (
                      <Badge
                        key={a.id}
                        variant={a.decision === "confirm" ? "success" : "destructive"}
                        className="font-medium"
                        title={a.note ?? undefined}
                      >
                        {a.decision === "confirm" ? "✓" : "!"} {a.actorName}
                      </Badge>
                    ))
                  )}
                </dd>
              </div>
              {e.resolutionNote && (
                <div className="sm:col-span-2">
                  <dt className="text-destructive font-bold uppercase">
                    {e.status === "rejected"
                      ? t("contributions.whyNotCounted")
                      : t("contributions.theDispute")}
                  </dt>
                  <dd>{e.resolutionNote}</dd>
                </div>
              )}
            </dl>
          </td>
        </tr>
      )}

      {/* Dispute */}
      <ReasonDialog
        open={disputing}
        onOpenChange={setDisputing}
        title={t("contributions.disputeReason")}
        hint={t("contributions.disputeReasonHint")}
        value={reason}
        onChange={setReason}
        confirmLabel={t("contributions.dispute")}
        pending={pending}
        onConfirm={() =>
          act(
            () => voteOnEntry({ entryId: e.id, decision: "dispute", note: reason }),
            t("contributions.disputeRecorded"),
          )
        }
      />

      {/* Reject */}
      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={t("contributions.markNotCounted")}
        hint={t("contributions.rejectHint")}
        value={reason}
        onChange={setReason}
        confirmLabel={t("contributions.markNotCounted")}
        pending={pending}
        onConfirm={() =>
          act(
            () => rejectEntry({ entryId: e.id, reason }),
            t("contributions.markedNotCounted"),
          )
        }
      />
    </>
  );
}

function ReasonDialog({
  open,
  onOpenChange,
  title,
  hint,
  value,
  onChange,
  confirmLabel,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">{hint}</p>
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            maxLength={500}
            aria-label={title}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onConfirm} disabled={pending || value.trim().length < 3}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
 * People
 * ========================================================== */

function PeoplePanel({
  pot,
  currency,
  canManage,
  onAdd,
  onPaste,
  onEdit,
  onRecordFor,
}: {
  pot: Detail;
  currency: string;
  canManage: boolean;
  onAdd: () => void;
  onPaste: () => void;
  onEdit: (c: ContributorRow) => void;
  onRecordFor: (c: ContributorRow) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [pending, start] = useTransition();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pot.contributors;
    return pot.contributors.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.memberName ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q),
    );
  }, [pot.contributors, query]);

  const unlinked = pot.contributors.filter((c) => !c.memberId).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("contributions.searchPeople")}
            aria-label={t("contributions.searchPeople")}
            className="pl-9"
          />
        </div>
        {canManage && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onPaste}>
              {t("contributions.pasteList")}
            </Button>
            <Button size="sm" onClick={onAdd}>
              <Plus className="size-4" aria-hidden /> {t("contributions.addPerson")}
            </Button>
          </div>
        )}
      </div>

      {unlinked > 0 && canManage && (
        <p className="text-muted-foreground text-sm">
          {t("contributions.notOnRegisterYet", { count: unlinked })}{" "}
          <Link href="/contributions/people" className="text-primary hover:underline">
            {t("contributions.matchThemUp")}
          </Link>
        </p>
      )}

      {rows.length === 0 ? (
        <p className="bg-card text-muted-foreground rounded-2xl border p-8 text-center text-sm">
          {pot.contributors.length === 0
            ? t("contributions.noPeople")
            : t("contributions.notMatchingThat")}
        </p>
      ) : (
        <div className="bg-card overflow-hidden rounded-2xl border">
          <ScrollableTable
            stickyFirstColumn
            label={t("contributions.tabPeople")}
            hint={t("common.scrollForMore")}
          >
            <table className="w-full min-w-[42rem] text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="px-3 py-2.5 text-left font-bold">
                    {t("common.name")}
                  </th>
                  <th className="px-3 py-2.5 text-right font-bold">
                    {t("contributions.expected")}
                  </th>
                  <th className="px-3 py-2.5 text-right font-bold">
                    {t("contributions.paid")}
                  </th>
                  <th className="px-3 py-2.5 text-right font-bold">
                    {t("contributions.outstanding")}
                  </th>
                  <th className="px-3 py-2.5 text-right font-bold">
                    <span className="sr-only">{t("contributions.colActions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/30 border-t">
                    <td className="px-3 py-3">
                      <span className="font-semibold">{c.name}</span>
                      <span className="text-muted-foreground block text-xs">
                        {[
                          c.memberId
                            ? c.memberName && c.memberName !== c.name
                              ? t("contributions.onRegisterAs", {
                                  name: c.memberName,
                                })
                              : t("contributions.onRegister")
                            : t("contributions.notOnRegister"),
                          c.phone,
                          c.isAnonymous ? t("contributions.shownAnonymous") : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {c.expected != null ? formatMoney(c.expected, currency) : "—"}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">
                      {formatMoney(c.paid, currency)}
                      {c.pending > 0 && (
                        <span className="text-muted-foreground block text-xs">
                          +{formatMoneyCompact(c.pending, currency)} awaiting
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {c.outstanding > 0 ? (
                        <span className="text-warning font-semibold">
                          {formatMoney(c.outstanding, currency)}
                        </span>
                      ) : c.settled ? (
                        <Badge variant="success">{t("contributions.paidUp")}</Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {canManage && (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onRecordFor(c)}
                          >
                            <Plus className="size-4" aria-hidden />{" "}
                            {t("contributions.paymentLabel")}
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={t("contributions.personActions", {
                                  name: c.name,
                                })}
                              >
                                <MoreVertical className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => onEdit(c)}>
                                <Pencil className="size-4" aria-hidden />{" "}
                                {t("common.edit")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={pending}
                                onClick={() => {
                                  if (
                                    !confirm(
                                      t("contributions.confirmRemovePerson", {
                                        name: c.name,
                                      }),
                                    )
                                  )
                                    return;
                                  start(async () => {
                                    const res = await removeContributor(c.id);
                                    if (res.ok) {
                                      toast.success(t("contributions.deleted"));
                                      router.refresh();
                                    } else toast.error(res.error);
                                  });
                                }}
                              >
                                <Trash2 className="size-4" aria-hidden />{" "}
                                {t("contributions.removePerson")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * Money out
 * ========================================================== */

function PayoutsPanel({
  pot,
  currency,
  canManage,
  currentUserId,
  onRecord,
  onEdit,
  financeAccounts,
  canPostToFinance,
}: {
  pot: Detail;
  currency: string;
  canManage: boolean;
  currentUserId: string;
  onRecord: () => void;
  onEdit: (p: PayoutRow) => void;
  financeAccounts: { id: string; name: string }[];
  canPostToFinance: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [objecting, setObjecting] = useState<PayoutRow | null>(null);
  const [reason, setReason] = useState("");
  const available = pot.balance - pot.pendingOut;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {t("contributions.availableToPayOut")}:{" "}
          <span className="text-foreground font-bold tabular-nums">
            {formatMoney(available, currency)}
          </span>
          {pot.pendingOut > 0 && (
            <span className="block text-xs">
              {t("contributions.committedNote", {
                amount: formatMoney(pot.pendingOut, currency),
              })}
            </span>
          )}
        </p>
        {canManage && (
          <Button size="sm" onClick={onRecord} disabled={available <= 0}>
            <Plus className="size-4" aria-hidden /> {t("contributions.recordPayout")}
          </Button>
        )}
      </div>

      {pot.payouts.length === 0 ? (
        <p className="bg-card text-muted-foreground rounded-2xl border p-8 text-center text-sm">
          {t("contributions.noPayouts")}
        </p>
      ) : (
        <div className="space-y-2">
          {pot.payouts.map((p) => {
            const myVote = p.approvals.find((a) => a.userId === currentUserId);
            return (
              <div key={p.id} className="bg-card rounded-2xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold tabular-nums">
                        {formatMoney(p.amount, currency)}
                      </p>
                      <Badge variant="secondary">{PAYOUT_KIND_LABEL[p.kind]}</Badge>
                      <PayoutStatusBadge status={p.status} />
                      {p.financeTransactionId && (
                        <Badge variant="outline">{t("contributions.inFinance")}</Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {[p.purpose, p.payee, p.paidOn]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {p.status === "pending" && (
                      <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                        {t("contributions.needsApprovals", {
                          have: p.approvalCount,
                          need: pot.payoutApprovalsRequired,
                        })}
                      </p>
                    )}
                    {p.resolutionNote && (
                      <p className="text-destructive mt-1 text-xs">{p.resolutionNote}</p>
                    )}
                    {p.approvals.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {p.approvals.map((a) => (
                          <Badge
                            key={a.id}
                            variant={a.decision === "confirm" ? "success" : "destructive"}
                            title={a.note ?? undefined}
                          >
                            {a.decision === "confirm" ? "✓" : "!"} {a.actorName}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  {canManage && (
                    <div className="flex flex-wrap items-center gap-1">
                      {p.status === "pending" && !myVote && (
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              const res = await voteOnPayout({
                                payoutId: p.id,
                                decision: "confirm",
                                financeAccountId:
                                  canPostToFinance && p.kind === "handover"
                                    ? (financeAccounts[0]?.id ?? null)
                                    : null,
                              });
                              if (res.ok) {
                                toast.success(t("contributions.approved"));
                                router.refresh();
                              } else toast.error(res.error);
                            })
                          }
                        >
                          {pending ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : (
                            <Check className="size-4" aria-hidden />
                          )}
                          {t("contributions.approve")}
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("contributions.payoutActions")}
                          >
                            <MoreVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          {p.status === "pending" && (
                            <>
                              <DropdownMenuItem onClick={() => onEdit(p)}>
                                <Pencil className="size-4" aria-hidden />{" "}
                                {t("common.edit")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setObjecting(p)}>
                                <AlertTriangle className="size-4" aria-hidden />{" "}
                                {t("contributions.object")}
                              </DropdownMenuItem>
                            </>
                          )}
                          {p.proofUrl && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem asChild>
                                <a
                                  href={p.proofUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Eye className="size-4" aria-hidden />{" "}
                                  {t("contributions.viewProof")}
                                </a>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  start(async () => {
                                    const res = await releaseProof({ payoutId: p.id });
                                    if (res.ok) {
                                      toast.success(
                                        t("contributions.proofReleasedToast"),
                                      );
                                      router.refresh();
                                    } else toast.error(res.error);
                                  })
                                }
                              >
                                <HardDrive className="size-4" aria-hidden />{" "}
                                {t("contributions.releaseProof")}
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => {
                              if (
                                !confirm(
                                  p.financeTransactionId
                                    ? t("contributions.confirmDeletePayoutFinance")
                                    : t("contributions.confirmDeletePayout"),
                                )
                              )
                                return;
                              start(async () => {
                                const res = await deletePayout(p.id);
                                if (res.ok) {
                                  toast.success(t("contributions.deleted"));
                                  router.refresh();
                                } else toast.error(res.error);
                              });
                            }}
                          >
                            <Trash2 className="size-4" aria-hidden />{" "}
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
                {p.proofReleasedAt && !p.proofUrl && (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {t("contributions.proofReleased", {
                      date: p.proofReleasedAt.slice(0, 10),
                    })}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ReasonDialog
        open={!!objecting}
        onOpenChange={(next) => {
          if (!next) {
            setObjecting(null);
            setReason("");
          }
        }}
        title={t("contributions.object")}
        hint={t("contributions.objectHint")}
        value={reason}
        onChange={setReason}
        confirmLabel={t("contributions.object")}
        pending={pending}
        onConfirm={() => {
          const target = objecting;
          if (!target) return;
          start(async () => {
            const res = await voteOnPayout({
              payoutId: target.id,
              decision: "dispute",
              note: reason,
            });
            if (res.ok) {
              toast.success(t("contributions.objectionRecorded"));
              setObjecting(null);
              setReason("");
              router.refresh();
            } else toast.error(res.error);
          });
        }}
      />
    </div>
  );
}
