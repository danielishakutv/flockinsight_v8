"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  Loader2,
  PauseCircle,
  PlayCircle,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { deleteChurch, setChurchStatus } from "@/app/superadmin/actions";
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
  createdAt: string;
  staffCount: number;
  memberCount: number;
};

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
                className="bg-card flex flex-wrap items-center gap-3 rounded-2xl border p-3 shadow-sm sm:p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-bold">{c.name}</p>
                    <Badge
                      variant={suspended ? "destructive" : "success"}
                      className="capitalize"
                    >
                      {c.status}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    /{c.slug} · {c.staffCount} staff · {c.memberCount} members ·
                    joined {format(parseISO(c.createdAt), "MMM d, yyyy")}
                  </p>
                </div>
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
                  Delete
                </Button>
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
