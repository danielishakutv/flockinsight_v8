"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  Download,
  EyeOff,
  Globe,
  Loader2,
  Pencil,
  Plus,
  Rocket,
  Search,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  addRoadmapItem,
  editRoadmapItem,
  importChangelog,
  moveRoadmapItem,
  removeRoadmapItem,
  unshipItem,
  type RoadmapItemInput,
} from "@/app/superadmin/roadmap/actions";
import {
  BOARD_ORDER,
  ROADMAP_AREAS,
  ROADMAP_PRIORITIES,
  ROADMAP_STATUSES,
  priorityMeta,
  statusMeta,
  type RoadmapPriority,
  type RoadmapStatus,
} from "@/lib/roadmap-shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

export type BoardItem = {
  id: string;
  title: string;
  detail: string | null;
  status: RoadmapStatus;
  priority: RoadmapPriority;
  area: string | null;
  isPublic: boolean;
  targetDate: string | null;
  shippedAt: string | null;
  version: string | null;
  churchesAtShip: number | null;
  usersAtShip: number | null;
  membersAtShip: number | null;
};

type FormState = {
  title: string;
  detail: string;
  status: RoadmapStatus;
  priority: RoadmapPriority;
  area: string;
  targetDate: string;
  version: string;
  isPublic: boolean;
};

const EMPTY: FormState = {
  title: "",
  detail: "",
  status: "idea",
  priority: "medium",
  area: "",
  targetDate: "",
  version: "",
  isPublic: false,
};

function toInput(f: FormState): RoadmapItemInput {
  return {
    title: f.title,
    detail: f.detail || null,
    status: f.status,
    priority: f.priority,
    area: f.area || null,
    targetDate: f.targetDate || null,
    version: f.version || null,
    isPublic: f.isPublic,
  };
}

function fmtDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** The frozen platform size, shown only where it exists. */
function ShipStamp({ item }: { item: BoardItem }) {
  const when = fmtDate(item.shippedAt);
  if (!when) return null;
  const has =
    item.churchesAtShip != null ||
    item.usersAtShip != null ||
    item.membersAtShip != null;

  return (
    <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      <span className="inline-flex items-center gap-1 font-semibold">
        <Rocket className="size-3" />
        {when}
        {item.version && ` · v${item.version}`}
      </span>
      {has && (
        <>
          <span className="inline-flex items-center gap-1">
            <Building2 className="size-3" />
            {item.churchesAtShip ?? 0} churches
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" />
            {(item.usersAtShip ?? 0).toLocaleString()} users ·{" "}
            {(item.membersAtShip ?? 0).toLocaleString()} members
          </span>
        </>
      )}
    </div>
  );
}

export function RoadmapBoard({ items }: { items: BoardItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BoardItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      [i.title, i.detail, i.area, i.version]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [items, query]);

  const columns = useMemo(
    () =>
      BOARD_ORDER.map((status) => ({
        status,
        meta: statusMeta(status),
        items: filtered.filter((i) => i.status === status),
      })),
    [filtered],
  );

  const shippedCount = items.filter((i) => i.status === "shipped").length;
  const publicCount = items.filter((i) => i.isPublic).length;

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  }

  function openEdit(item: BoardItem) {
    setEditing(item);
    setForm({
      title: item.title,
      detail: item.detail ?? "",
      status: item.status,
      priority: item.priority,
      area: item.area ?? "",
      targetDate: item.targetDate ?? "",
      version: item.version ?? "",
      isPublic: item.isPublic,
    });
    setOpen(true);
  }

  function save() {
    const payload = toInput(form);
    startTransition(async () => {
      const res = editing
        ? await editRoadmapItem(editing.id, payload)
        : await addRoadmapItem(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(editing ? "Saved" : "Added to the queue");
      setOpen(false);
      router.refresh();
    });
  }

  function move(item: BoardItem, status: RoadmapStatus) {
    startTransition(async () => {
      const res = await moveRoadmapItem({ id: item.id, status });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        status === "shipped"
          ? "Shipped — platform size recorded"
          : `Moved to ${statusMeta(status).label}`,
      );
      router.refresh();
    });
  }

  function unship(item: BoardItem) {
    startTransition(async () => {
      const res = await unshipItem(item.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Moved back to building");
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await removeRoadmapItem(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Deleted");
      setConfirmId(null);
      router.refresh();
    });
  }

  function doImport() {
    startTransition(async () => {
      const res = await importChangelog();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.added === 0
          ? "Already up to date — nothing new in the changelog"
          : `Imported ${res.added} shipped release${res.added === 1 ? "" : "s"}`,
      );
      router.refresh();
    });
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs sm:flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the roadmap"
            className="pl-9"
          />
        </div>
        <Button onClick={openNew} className="shrink-0">
          <Plus className="size-4" /> Add feature
        </Button>
        <Button
          variant="outline"
          onClick={doImport}
          disabled={pending}
          className="shrink-0"
          title="Create shipped entries from the changelog"
        >
          <Download className="size-4" /> Import changelog
        </Button>
      </div>

      <p className="text-muted-foreground text-xs">
        {items.length} item{items.length === 1 ? "" : "s"} · {shippedCount}{" "}
        shipped · {publicCount} visible on the public roadmap
      </p>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {columns.map((col) => (
          <section key={col.status} className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <span
                className={cn(
                  "rounded px-2 py-0.5 text-[11px] font-bold",
                  col.meta.className,
                )}
              >
                {col.meta.label}
              </span>
              <span className="text-muted-foreground text-xs font-semibold">
                {col.items.length}
              </span>
            </div>

            <div className="space-y-2">
              {col.items.length === 0 && (
                <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-xs">
                  {col.meta.hint}
                </p>
              )}

              {col.items.map((item) => {
                const isOpen = expanded.has(item.id);
                return (
                  <Card key={item.id} className="overflow-hidden">
                    <CardContent className="px-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm leading-snug font-bold">
                            {item.title}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] font-bold",
                                priorityMeta(item.priority).className,
                              )}
                            >
                              {priorityMeta(item.priority).label}
                            </span>
                            {item.area && (
                              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-semibold">
                                {item.area}
                              </span>
                            )}
                            {item.isPublic ? (
                              <span
                                title="Shown on the public roadmap"
                                className="inline-flex items-center gap-1 rounded bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"
                              >
                                <Globe className="size-2.5" /> Public
                              </span>
                            ) : (
                              <span
                                title="Internal only"
                                className="text-muted-foreground inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-semibold"
                              >
                                <EyeOff className="size-2.5" /> Internal
                              </span>
                            )}
                            {item.targetDate && item.status !== "shipped" && (
                              <span className="text-muted-foreground inline-flex items-center gap-1 text-[10px] font-semibold">
                                <CalendarClock className="size-2.5" />
                                {fmtDate(item.targetDate)}
                              </span>
                            )}
                          </div>
                          <ShipStamp item={item} />
                        </div>

                        <div className="flex shrink-0 items-center">
                          <button
                            type="button"
                            onClick={() => openEdit(item)}
                            aria-label={`Edit ${item.title}`}
                            className="hover:bg-accent text-muted-foreground rounded-md p-1.5"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(item.id)}
                            aria-label={`Delete ${item.title}`}
                            className="hover:bg-destructive/10 hover:text-destructive text-muted-foreground rounded-md p-1.5"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>

                      {item.detail && (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(item.id)}
                          className="text-muted-foreground hover:text-foreground mt-2 inline-flex items-center gap-1 text-[11px] font-semibold"
                        >
                          <ChevronDown
                            className={cn(
                              "size-3 transition-transform",
                              isOpen && "rotate-180",
                            )}
                          />
                          {isOpen ? "Hide spec" : "Show spec"}
                        </button>
                      )}
                      {item.detail && isOpen && (
                        <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed whitespace-pre-wrap">
                          {item.detail}
                        </p>
                      )}

                      {confirmId === item.id ? (
                        <div className="mt-2 flex items-center gap-2 rounded-md border border-dashed p-2">
                          <p className="flex-1 text-[11px] font-medium">
                            Delete this permanently?
                          </p>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => remove(item.id)}
                            disabled={pending}
                          >
                            Delete
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {BOARD_ORDER.filter((s) => s !== item.status).map(
                            (s) => (
                              <button
                                key={s}
                                type="button"
                                disabled={pending}
                                onClick={() => move(item, s)}
                                className="hover:bg-accent text-muted-foreground hover:text-foreground rounded border px-1.5 py-0.5 text-[10px] font-semibold disabled:opacity-50"
                              >
                                → {statusMeta(s).label}
                              </button>
                            ),
                          )}
                          {item.status === "shipped" && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => unship(item)}
                              title="Clear the ship date and the recorded platform size"
                              className="hover:bg-accent text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold disabled:opacity-50"
                            >
                              <Undo2 className="size-2.5" /> Un-ship
                            </button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit item" : "Add to the roadmap"}
            </DialogTitle>
            <DialogDescription>
              The spec is what a future build session works from — the more
              precise it is, the less has to be re-explained.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rm-title">Title</Label>
              <Input
                id="rm-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Children's check-in"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rm-detail">Spec / notes</Label>
              <Textarea
                id="rm-detail"
                rows={7}
                value={form.detail}
                onChange={(e) => setForm({ ...form, detail: e.target.value })}
                placeholder={
                  "What it does, who it's for, and what done looks like.\nMarkdown is fine."
                }
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {!editing && (
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select
                    value={form.status}
                    onValueChange={(v) =>
                      setForm({ ...form, status: v as RoadmapStatus })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROADMAP_STATUSES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v) =>
                    setForm({ ...form, priority: v as RoadmapPriority })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROADMAP_PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Area</Label>
                <Select
                  value={form.area || "__none__"}
                  onValueChange={(v) =>
                    setForm({ ...form, area: v === "__none__" ? "" : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick an area" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No area</SelectItem>
                    {ROADMAP_AREAS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rm-target">Target date</Label>
                <Input
                  id="rm-target"
                  type="date"
                  value={form.targetDate}
                  onChange={(e) =>
                    setForm({ ...form, targetDate: e.target.value })
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rm-version">Version</Label>
                <Input
                  id="rm-version"
                  value={form.version}
                  onChange={(e) => setForm({ ...form, version: e.target.value })}
                  placeholder="0.61.0"
                />
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border p-3">
              <Switch
                id="rm-public"
                checked={form.isPublic}
                onCheckedChange={(v) => setForm({ ...form, isPublic: v })}
              />
              <div className="min-w-0">
                <Label htmlFor="rm-public" className="cursor-pointer">
                  Show on the public roadmap
                </Label>
                <p className="text-muted-foreground text-xs">
                  Anyone can read it, competitors included. Platform sizes are
                  never published, whatever this is set to.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !form.title.trim()}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              {editing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
