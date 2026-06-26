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
  Search,
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
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ChurchRow = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  currency: string;
  createdAt: string;
  featured: boolean;
  ownerEmail: string | null;
  staffCount: number;
  memberCount: number;
  groupCount: number;
  sessionCount: number;
  lastActivity: string | null;
  totalGiving: number;
};

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-bold tabular-nums leading-none">{value}</p>
      <p className="text-muted-foreground mt-0.5 text-[10px] font-semibold uppercase tracking-wide">
        {label}
      </p>
    </div>
  );
}

export function ChurchesTable({ churches }: { churches: ChurchRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Delete confirmation state.
  const [deleteTarget, setDeleteTarget] = useState<ChurchRow | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, startDelete] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return churches;
    return churches.filter((c) =>
      [c.name, c.slug].some((v) => v.toLowerCase().includes(q)),
    );
  }, [churches, query]);

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
      <div className="relative max-w-md">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search churches"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="text-muted-foreground py-10 text-center">
            No churches found.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => {
            const suspended = c.status === "suspended";
            const busy = busyId === c.id && pending;
            return (
              <div
                key={c.id}
                className="bg-card rounded-2xl border p-3 shadow-sm sm:p-4"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <Link
                    href={`/superadmin/churches/${c.id}`}
                    className="group min-w-0 flex-1"
                  >
                    <div className="flex items-center gap-2">
                      <p className="group-hover:text-primary truncate font-bold transition-colors">
                        {c.name}
                      </p>
                      <Badge
                        variant={suspended ? "destructive" : "success"}
                        className="capitalize"
                      >
                        {c.status}
                      </Badge>
                      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                    </div>
                    <p className="text-muted-foreground truncate text-xs">
                      /{c.slug}
                      {c.ownerEmail ? ` · ${c.ownerEmail}` : ""} · joined{" "}
                      {format(parseISO(c.createdAt), "MMM d, yyyy")}
                    </p>
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleFeatured(c)}
                      title={c.featured ? "Unfeature" : "Feature in directory"}
                      className={c.featured ? "text-amber-500" : "text-muted-foreground"}
                    >
                      <Star className={c.featured ? "size-4 fill-current" : "size-4"} />
                    </Button>
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openDelete(c)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      aria-label={`Delete ${c.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>

                {/* Per-church numbers */}
                <div className="mt-3 grid grid-cols-3 gap-3 border-t pt-3 sm:grid-cols-6">
                  <Metric label="Members" value={c.memberCount} />
                  <Metric label="Staff" value={c.staffCount} />
                  <Metric label="Groups" value={c.groupCount} />
                  <Metric label="Services" value={c.sessionCount} />
                  <div className="col-span-2 min-w-0">
                    <p className="inline-flex items-center gap-1 text-sm font-bold tabular-nums leading-none">
                      <HandCoins className="text-muted-foreground size-3.5" />
                      {formatMoney(c.totalGiving, c.currency)}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-[10px] font-semibold uppercase tracking-wide">
                      Total giving
                    </p>
                  </div>
                </div>
                <p className="text-muted-foreground mt-2 inline-flex items-center gap-1 text-xs">
                  <UsersRound className="size-3.5" />
                  {c.lastActivity
                    ? `Last activity ${format(parseISO(c.lastActivity), "MMM d, yyyy")}`
                    : "No activity recorded yet"}
                </p>
              </div>
            );
          })}
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
