"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  ChevronRight,
  HandCoins,
  Loader2,
  LogIn,
  PauseCircle,
  PlayCircle,
  Star,
  Trash2,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteChurch,
  impersonateChurch,
  setChurchFeatured,
  setChurchStatus,
} from "@/app/superadmin/actions";
import { formatMoney } from "@/lib/money";
import { HEALTH_LABELS, type ChurchHealth } from "@/lib/health-rules";
import {
  FunnelDots,
  HealthBadge,
  LastSeen,
} from "@/components/superadmin/health-badge";
import { VerifiedTick } from "@/components/app/verified-tick";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AdminChips,
  AdminSearch,
  AdminSort,
  RowActions,
} from "@/components/superadmin/list-kit";

export type ChurchRow = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  currency: string;
  createdAt: string;
  featured: boolean;
  /** Both account email and phone confirmed — shows a tick beside the name. */
  verified: boolean;
  ownerEmail: string | null;
  staffCount: number;
  memberCount: number;
  groupCount: number;
  sessionCount: number;
  /** Newest activity across every module, ISO. Null = genuinely never used. */
  lastSeenAt: string | null;
  health: ChurchHealth;
  funnelCompleted: number;
  totalGiving: number;
  /** Payments + wallet top-ups, all time. */
  revenue: number;
  /** SMS pages + storage add-ons, all time. */
  cost: number;
};

type FilterKey = "all" | ChurchHealth;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "healthy", label: "Healthy" },
  { key: "idle", label: "Idle" },
  { key: "at_risk", label: "At risk" },
  { key: "never_activated", label: "Never activated" },
  { key: "dormant", label: "Dormant" },
  { key: "suspended", label: "Suspended" },
];

type SortKey = "recent" | "members" | "revenue" | "joined";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Last active" },
  { key: "members", label: "Members" },
  { key: "revenue", label: "Revenue" },
  { key: "joined", label: "Joined" },
];

/** Churches past this count get paged so the list stays fast. */
const PAGE_SIZE = 100;

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    // Label first for the markup, number first on screen.
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="text-muted-foreground mt-1 truncate text-[10px] font-semibold uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-sm font-bold tabular-nums leading-none">{value}</dd>
    </div>
  );
}

export function ChurchesTable({ churches }: { churches: ChurchRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [page, setPage] = useState(0);

  // Delete confirmation state.
  const [deleteTarget, setDeleteTarget] = useState<ChurchRow | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, startDelete] = useTransition();

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: churches.length };
    for (const row of churches) c[row.health] = (c[row.health] ?? 0) + 1;
    return c;
  }, [churches]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = churches.filter((c) => {
      if (filter !== "all" && c.health !== filter) return false;
      if (!q) return true;
      // Owner email matters: it is how you actually reach someone.
      return [c.name, c.slug, c.ownerEmail ?? ""].some((v) =>
        v.toLowerCase().includes(q),
      );
    });

    const at = (c: ChurchRow) =>
      c.lastSeenAt ? Date.parse(c.lastSeenAt) : 0;

    return [...rows].sort((a, b) => {
      switch (sort) {
        case "members":
          return b.memberCount - a.memberCount;
        case "revenue":
          return b.revenue - a.revenue;
        case "joined":
          return Date.parse(b.createdAt) - Date.parse(a.createdAt);
        default:
          return at(b) - at(a);
      }
    });
  }, [churches, query, filter, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  const [enteringId, setEnteringId] = useState<string | null>(null);
  function enter(c: ChurchRow) {
    setEnteringId(c.id);
    startTransition(async () => {
      // On success this redirects into the church, so we only get here on error.
      const res = await impersonateChurch(c.id);
      setEnteringId(null);
      if (res && !res.ok) toast.error(res.error);
    });
  }

  function toggleFeatured(c: ChurchRow) {
    startTransition(async () => {
      const res = await setChurchFeatured(c.id, !c.featured);
      if (!res.ok) return void toast.error(res.error);
      toast.success(c.featured ? "Removed from featured" : "Featured");
      router.refresh();
    });
  }

  function toggle(c: ChurchRow) {
    const next = c.status === "active" ? "suspended" : "active";
    setBusyId(c.id);
    startTransition(async () => {
      const res = await setChurchStatus(c.id, next);
      setBusyId(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        next === "suspended"
          ? `${c.name} suspended`
          : `${c.name} reactivated`,
      );
      router.refresh();
    });
  }

  function openDelete(c: ChurchRow) {
    setDeleteTarget(c);
    setConfirmName("");
  }

  function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    startDelete(async () => {
      const res = await deleteChurch(target.id, confirmName);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${target.name} deleted permanently`);
      setDeleteTarget(null);
      setConfirmName("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <AdminSearch
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(0);
            }}
            placeholder="Search by name, URL or owner email"
          />
          <AdminSort value={sort} options={SORTS} onChange={setSort} />
        </div>

        {/* Health buckets, with counts — the shape of the platform at a glance. */}
        <AdminChips
          label="Filter by health"
          value={filter}
          onChange={(k) => {
            setFilter(k);
            setPage(0);
          }}
          options={FILTERS.filter(
            (f) => f.key === "all" || (counts[f.key] ?? 0) > 0,
          ).map((f) => ({ ...f, count: counts[f.key] ?? 0 }))}
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="text-muted-foreground py-10 text-center">
            {filter === "all"
              ? "No churches found."
              : `No churches are ${HEALTH_LABELS[filter as ChurchHealth].toLowerCase()}.`}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {visible.map((c) => {
            const suspended = c.status === "suspended";
            const busy = busyId === c.id && pending;
            const net = c.revenue - c.cost;
            return (
              <article
                key={c.id}
                className="bg-card flex min-w-0 flex-col overflow-hidden rounded-xl border"
              >
                <Link
                  href={`/superadmin/churches/${c.id}`}
                  className="group hover:bg-accent/40 block flex-1 p-4 transition-colors"
                >
                  {/* The name first, on its own, allowed two lines. */}
                  <div className="flex items-start gap-2">
                    <h3 className="group-hover:text-primary line-clamp-2 min-w-0 flex-1 text-base leading-snug font-semibold break-words transition-colors">
                      {c.name}
                      {c.verified && (
                        <VerifiedTick className="ml-1 inline-block size-4 align-[-2px]" />
                      )}
                    </h3>
                    <ChevronRight className="text-muted-foreground mt-0.5 size-5 shrink-0" />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <HealthBadge health={c.health} />
                    {c.featured && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                        <Star className="size-3 fill-current" />
                        Featured
                      </span>
                    )}
                    <span className="text-muted-foreground text-xs">
                      Joined {format(parseISO(c.createdAt), "MMM d, yyyy")}
                    </span>
                  </div>

                  <div className="text-muted-foreground mt-1.5 space-y-0.5 text-xs">
                    {c.ownerEmail && <p className="truncate">{c.ownerEmail}</p>}
                    <p className="truncate">/{c.slug}</p>
                  </div>

                  {/* Per-church numbers */}
                  <dl className="bg-muted/50 mt-3 grid grid-cols-4 gap-1 rounded-lg px-2 py-2.5 text-center">
                    <Metric label="Members" value={c.memberCount} />
                    <Metric label="Staff" value={c.staffCount} />
                    <Metric label="Groups" value={c.groupCount} />
                    <Metric label="Services" value={c.sessionCount} />
                  </dl>

                  <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="inline-flex min-w-0 items-center gap-1.5 text-sm">
                      <HandCoins className="text-muted-foreground size-4 shrink-0" />
                      <span className="text-muted-foreground">Giving</span>
                      <span className="truncate font-semibold tabular-nums">
                        {formatMoney(c.totalGiving, c.currency)}
                      </span>
                    </p>
                    {c.revenue > 0 && (
                      <p
                        title="Payments and wallet top-ups, minus SMS and storage costs"
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          net < 0 && "text-destructive",
                        )}
                      >
                        {formatMoney(net, "NGN")}{" "}
                        <span className="text-muted-foreground font-normal">net</span>
                      </p>
                    )}
                  </div>

                  <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1">
                      <UsersRound className="size-3.5" />
                      <LastSeen at={c.lastSeenAt} />
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <FunnelDots completed={c.funnelCompleted} />
                      <span>{c.funnelCompleted}/5 set up</span>
                    </span>
                  </div>
                </Link>

                <RowActions
                  moreLabel={`More actions for ${c.name}`}
                  more={
                    <>
                      <DropdownMenuItem onSelect={() => toggleFeatured(c)}>
                        <Star className={c.featured ? "fill-current" : undefined} />
                        {c.featured ? "Remove from featured" : "Feature in directory"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => openDelete(c)}
                      >
                        <Trash2 />
                        Delete church…
                      </DropdownMenuItem>
                    </>
                  }
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => enter(c)}
                    disabled={pending && enteringId === c.id}
                    title={`Open ${c.name}'s workspace as super admin`}
                  >
                    {pending && enteringId === c.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <LogIn className="size-4" />
                    )}
                    Log in
                  </Button>
                  <Button
                    variant={suspended ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggle(c)}
                    disabled={busy}
                  >
                    {busy ? (
                      <Loader2 className="animate-spin" />
                    ) : suspended ? (
                      <PlayCircle className="size-4" />
                    ) : (
                      <PauseCircle className="size-4" />
                    )}
                    {suspended ? "Reactivate" : "Suspend"}
                  </Button>
                </RowActions>
              </article>
            );
          })}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-muted-foreground text-xs">
            Showing {safePage * PAGE_SIZE + 1}–
            {Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of{" "}
            {filtered.length}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setDeleteTarget(null);
            setConfirmName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <div className="bg-destructive/10 text-destructive mb-1 grid size-11 place-items-center rounded-full">
              <TriangleAlert className="size-5" />
            </div>
            <DialogTitle>Delete this church permanently?</DialogTitle>
            <DialogDescription>
              This <span className="font-semibold">cannot be undone</span>.
              Deleting{" "}
              <span className="text-foreground font-semibold">
                {deleteTarget?.name}
              </span>{" "}
              will permanently remove its {deleteTarget?.staffCount ?? 0} staff,{" "}
              {deleteTarget?.memberCount ?? 0} members, and all services,
              attendance, and invitations. User login accounts are kept.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="confirm-church-name">
              Type{" "}
              <span className="text-foreground font-semibold">
                {deleteTarget?.name}
              </span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-church-name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={deleteTarget?.name}
              autoComplete="off"
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
                setConfirmName("");
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting || confirmName.trim() !== deleteTarget?.name}
            >
              {deleting && <Loader2 className="animate-spin" />}
              Delete church
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
