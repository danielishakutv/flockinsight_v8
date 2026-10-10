"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, FolderTree, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createBranchBand,
  deleteBranchBand,
  moveBranchBand,
  renameBranchBand,
} from "@/app/(app)/branches/actions";
import {
  BAND_KINDS,
  buildBandTree,
  flattenBandTree,
  type BandNode,
} from "@/lib/branch-groups-shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Band = BandNode & { branches: number };

/** The sentinel a Select uses for "no parent", since "" is not a legal value. */
const TOP = "__top__";

/**
 * The shape of the network, as the headquarters draws it.
 *
 * Deliberately not a fixed National → Zonal → District ladder. Every network
 * organises itself differently, and the ones that do not fit the ladder are
 * exactly the ones a ladder would turn away — so a band carries the church's
 * own word for what it is and points at the band above it, and the depth is
 * whatever they build.
 *
 * Deleting is the only destructive thing here, so it is the only thing behind
 * a dialog, and the dialog says what will happen to both the bands underneath
 * and the churches inside before anybody agrees to it. No church is ever
 * deleted by anything on this page.
 */
export function BranchBands({ bands }: { bands: Band[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("Zonal");
  const [parentId, setParentId] = useState<string>(TOP);

  const [editing, setEditing] = useState<Band | null>(null);
  const [editName, setEditName] = useState("");
  const [editKind, setEditKind] = useState("");
  const [removing, setRemoving] = useState<Band | null>(null);

  const tree = buildBandTree(bands);
  const flat = flattenBandTree(tree);

  function add() {
    if (!name.trim()) return void toast.error("Give the group a name.");
    startTransition(async () => {
      const res = await createBranchBand({
        name,
        kind,
        parentId: parentId === TOP ? null : parentId,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`"${name.trim()}" added.`);
      setName("");
      router.refresh();
    });
  }

  function saveEdit() {
    const band = editing;
    if (!band) return;
    startTransition(async () => {
      const res = await renameBranchBand({
        bandId: band.id,
        name: editName,
        kind: editKind,
      });
      if (!res.ok) return void toast.error(res.error);
      setEditing(null);
      router.refresh();
    });
  }

  function move(band: Band, next: string) {
    startTransition(async () => {
      const res = await moveBranchBand({
        bandId: band.id,
        parentId: next === TOP ? null : next,
      });
      // The refusal is a sentence, not a shrug: moving a band inside its own
      // child would make a loop, and the person rearranging deserves to know
      // which move was impossible and why.
      if (!res.ok) return void toast.error(res.error);
      router.refresh();
    });
  }

  function remove() {
    const band = removing;
    if (!band) return;
    startTransition(async () => {
      const res = await deleteBranchBand({ bandId: band.id });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`"${band.name}" deleted.`);
      setRemoving(null);
      router.refresh();
    });
  }

  /** Bands this one may be moved into: every band but itself. */
  const parentChoices = (exclude?: string) =>
    flat.filter((b) => b.id !== exclude);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderTree className="text-primary size-4" />
          How your network is organised
        </CardTitle>
        <p className="text-muted-foreground text-sm">
          Build the bands you actually use — national, zonal, district, or your own
          word for them — and file each branch into one. Reports and exports can
          then be read for any band, including everything underneath it.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Add */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1">
            <label className="text-muted-foreground mb-1 block text-xs font-semibold uppercase">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. North Central"
              className="h-9"
            />
          </div>
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-semibold uppercase">
              Kind
            </label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BAND_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-semibold uppercase">
              Inside
            </label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent searchPlaceholder="Search groups…">
                <SelectItem value={TOP}>Nothing — top level</SelectItem>
                {flat.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {" ".repeat(b.depth * 2)}
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={add} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add group
          </Button>
        </div>

        {/* The tree */}
        {flat.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
            No groups yet. Add your widest band first — a country or a region —
            then add the ones that sit inside it.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {flat.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center gap-2 px-3 py-2"
                style={{ paddingLeft: `${0.75 + b.depth * 1.25}rem` }}
              >
                {b.depth > 0 && (
                  <ChevronRight
                    className="text-muted-foreground size-3.5 shrink-0"
                    aria-hidden
                  />
                )}
                <span className="font-medium">{b.name}</span>
                <span className="bg-accent text-muted-foreground rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase">
                  {b.kind}
                </span>
                <span className="text-muted-foreground text-xs">
                  {b.branches === 0
                    ? "no branches filed here"
                    : `${b.branches} branch${b.branches === 1 ? "" : "es"}`}
                </span>

                <div className="ml-auto flex items-center gap-1">
                  <Select
                    value={b.parentId ?? TOP}
                    onValueChange={(v) => move(b, v)}
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-8 w-40"
                      aria-label={`Move ${b.name}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent searchPlaceholder="Search groups…">
                      <SelectItem value={TOP}>Top level</SelectItem>
                      {parentChoices(b.id).map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {" ".repeat(o.depth * 2)}
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={`Rename ${b.name}`}
                    onClick={() => {
                      setEditing(b);
                      setEditName(b.name);
                      setEditKind(b.kind);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive size-8"
                    aria-label={`Delete ${b.name}`}
                    onClick={() => setRemoving(b)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {/* Rename */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Name"
            />
            <Select value={editKind} onValueChange={setEditKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BAND_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete, with what it will actually do */}
      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{removing?.name}&rdquo;?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Any groups inside this one are deleted with it.{" "}
                  <strong>No church is deleted.</strong> Every branch filed here
                  simply becomes unfiled, and you can put it somewhere else
                  afterwards.
                </p>
                {removing && removing.branches > 0 && (
                  <p>
                    {removing.branches} branch
                    {removing.branches === 1 ? "" : "es"} filed directly here will
                    be unfiled.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={remove} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Delete group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
