"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Baby,
  Check,
  Crown,
  Home,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserMinus,
} from "lucide-react";
import { toast } from "sonner";
import {
  addMembersToHousehold,
  deleteHousehold,
  removeMemberFromHousehold,
  renameHousehold,
  setHouseholdHead,
} from "@/app/(app)/members/households/actions";
import type { HouseholdDetail as Detail } from "@/lib/households";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Candidate = { id: string; name: string; isMinor: boolean };

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export function HouseholdDetail({
  household: h,
  canManage,
  candidates,
}: {
  household: Detail;
  canManage: boolean;
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(h.name);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? candidates.filter((c) => c.name.toLowerCase().includes(q))
      : candidates;
  }, [candidates, query]);

  function rename() {
    start(async () => {
      const res = await renameHousehold(h.id, name);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Renamed");
      setRenameOpen(false);
      router.refresh();
    });
  }
  function makeHead(memberId: string | null) {
    start(async () => {
      const res = await setHouseholdHead(h.id, memberId);
      if (!res.ok) return void toast.error(res.error);
      toast.success(memberId ? "Head updated" : "Head cleared");
      router.refresh();
    });
  }
  function removeMember(memberId: string) {
    start(async () => {
      const res = await removeMemberFromHousehold(h.id, memberId);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Removed from household");
      router.refresh();
    });
  }
  function addPicked() {
    start(async () => {
      const res = await addMembersToHousehold(h.id, [...picked]);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Members added");
      setAddOpen(false);
      setPicked(new Set());
      setQuery("");
      router.refresh();
    });
  }
  function removeHousehold() {
    if (
      !confirm(
        `Delete the "${h.name}" household? The members stay — only the grouping is removed.`,
      )
    )
      return;
    start(async () => {
      const res = await deleteHousehold(h.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Household deleted");
      router.push("/members/households");
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 text-primary grid size-12 shrink-0 place-items-center rounded-xl">
            <Home className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">{h.name}</h1>
            <p className="text-muted-foreground text-sm">
              {h.members.length} member{h.members.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        {canManage && (
          <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)}>
            <Pencil className="size-4" /> Rename
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-lg">Members</CardTitle>
          {canManage && (
            <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" /> Add members
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {h.members.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No one in this household yet.
            </p>
          ) : (
            h.members.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-3 rounded-xl border p-3"
              >
                <Avatar className="size-10">
                  <AvatarFallback className="bg-primary/15 text-primary font-bold">
                    {initials(m.name) || "?"}
                  </AvatarFallback>
                </Avatar>
                <Link href={`/members/${m.id}`} className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-semibold">
                    {m.name}
                    {m.isHead && (
                      <Crown className="size-3.5 text-amber-500" />
                    )}
                    {m.isMinor && <Baby className="text-muted-foreground size-3.5" />}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {m.isHead ? "Head of household · " : ""}
                    {m.relationship
                      ? `${m.relationship} · `
                      : ""}
                    {m.phone || m.email || (m.isMinor ? "Child" : "No contact")}
                  </p>
                </Link>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    {!m.isHead && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => makeHead(m.id)}
                        title="Make head of household"
                      >
                        <Crown className="size-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      onClick={() => removeMember(m.id)}
                      title="Remove from household"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <UserMinus className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
          {canManage && h.headMemberId && (
            <button
              type="button"
              onClick={() => makeHead(null)}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              Clear head of household
            </button>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={removeHousehold}
            disabled={pending}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-4" /> Delete household
          </Button>
        </div>
      )}

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={(o) => !pending && setRenameOpen(o)}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Rename household</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rn">Name</Label>
            <Input
              id="rn"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && rename()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={rename} disabled={pending || !name.trim()}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add members dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => !pending && setAddOpen(o)}>
        <DialogContent
          className="max-h-[85dvh] overflow-hidden sm:max-w-md"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>Add members</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search members"
                className="pl-9"
              />
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-1">
              {filtered.length === 0 ? (
                <p className="text-muted-foreground p-3 text-sm">
                  No members to add.
                </p>
              ) : (
                filtered.map((c) => {
                  const on = picked.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() =>
                        setPicked((p) => {
                          const n = new Set(p);
                          if (n.has(c.id)) n.delete(c.id);
                          else n.add(c.id);
                          return n;
                        })
                      }
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md p-2 text-left text-sm transition-colors",
                        on ? "bg-primary/10 text-primary" : "hover:bg-accent",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded border",
                          on
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-input",
                        )}
                      >
                        {on && <Check className="size-3" />}
                      </span>
                      <span className="truncate">{c.name}</span>
                      {c.isMinor && (
                        <Baby className="text-muted-foreground ml-auto size-3.5" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={addPicked} disabled={pending || picked.size === 0}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Add {picked.size || ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
