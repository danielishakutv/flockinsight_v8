"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  ChevronDown,
  Circle,
  Download,
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
  ROADMAP_AREAS,
  ROADMAP_PRIORITIES,
  priorityMeta,
  type RoadmapPriority,
} from "@/lib/roadmap-shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

/**
 * The roadmap, as a list you can tick.
 *
 * It was a five-column kanban board with drag-and-drop. The only move anybody
 * ever made on it was "this is done now", and making that move meant finding
 * the card in one column and dragging it across four others — on a phone,
 * which is where it was mostly read. Everything else the board offered was a
 * filing decision taken every time an idea got written down.
 *
 * So: one list, a round button at the left of each row, and that button is the
 * whole interaction. Tap it and the item ships, with the date and the size of
 * the platform that day stamped on it. Everything else — the spec, the
 * priority, whether churches can see it — is behind the row, where it does not
 * compete with the one thing you came here to do.
 */

export type TaskItem = {
  id: string;
  title: string;
  detail: string | null;
  status: "todo" | "shipped";
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
  priority: RoadmapPriority;
  area: string;
  targetDate: string;
  version: string;
  isPublic: boolean;
};

const EMPTY: FormState = {
  title: "",
  detail: "",
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

/** The frozen platform size. Only ever shown where it exists. */
function ShipStamp({ item }: { item: TaskItem }) {
  const when = fmtDate(item.shippedAt);
  if (!when) return null;
  const has =
    item.churchesAtShip != null ||
    item.usersAtShip != null ||
    item.membersAtShip != null;

  return (
    <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
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

/**
 * One row.
 *
 * Defined at module scope, not inside RoadmapList. A component declared inside
 * another is a NEW component type on every render, so React unmounts and
 * remounts the whole subtree — here, every row in the list on every keystroke
 * in the search box. It looked fine because a row holds no state of its own;
 * it was still throwing away and rebuilding the entire list to filter it.
 */
function Row({
  item,
  pending,
  isOpen,
  onToggleExpanded,
  onShip,
  onUnship,
  onEdit,
  onDelete,
}: {
  item: TaskItem;
  pending: boolean;
  isOpen: boolean;
  onToggleExpanded: (id: string) => void;
  onShip: (item: TaskItem) => void;
  onUnship: (item: TaskItem) => void;
  onEdit: (item: TaskItem) => void;
  onDelete: (item: TaskItem) => void;
}) {
  const isShipped = item.status === "shipped";
  const pri = priorityMeta(item.priority);

  return (
    <li className="border-b last:border-b-0">
      <div className="flex items-start gap-3 px-1 py-2.5">
        {/*
          The whole point of the page. Big enough to hit with a thumb
          (44px of tap target around a 20px circle) because this is read
          and ticked on a phone far more often than at a desk.
        */}
        <button
          type="button"
          disabled={pending}
          onClick={() => (isShipped ? onUnship(item) : onShip(item))}
          aria-label={isShipped ? `Un-ship ${item.title}` : `Mark ${item.title} shipped`}
          className={cn(
            "mt-0.5 grid size-9 shrink-0 place-items-center rounded-full transition",
            "hover:bg-muted disabled:opacity-50",
          )}
        >
          {isShipped ? (
            <span className="grid size-5 place-items-center rounded-full bg-emerald-600 text-white">
              <Check className="size-3.5" strokeWidth={3} />
            </span>
          ) : (
            <Circle className="text-muted-foreground size-5" strokeWidth={2} />
          )}
        </button>

        <button
          type="button"
          onClick={() => onToggleExpanded(item.id)}
          className="min-w-0 flex-1 text-left"
        >
          <span
            className={cn(
              "font-semibold",
              isShipped && "text-muted-foreground line-through decoration-1",
            )}
          >
            {item.title}
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {!isShipped && item.priority !== "medium" && (
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-bold",
                  pri.className,
                )}
              >
                {pri.label}
              </span>
            )}
            {item.area && (
              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-semibold">
                {item.area}
              </span>
            )}
            {item.isPublic && (
              <span className="text-muted-foreground inline-flex items-center gap-1 text-[10px] font-semibold">
                <Globe className="size-3" /> Public
              </span>
            )}
          </span>

          {isShipped && <ShipStamp item={item} />}
        </button>

        <ChevronDown
          className={cn(
            "text-muted-foreground mt-2 size-4 shrink-0 transition",
            isOpen && "rotate-180",
          )}
        />
      </div>

      {isOpen && (
        <div className="space-y-3 pr-1 pb-3 pl-12">
          {item.detail ? (
            <p className="text-muted-foreground text-sm whitespace-pre-wrap">
              {item.detail}
            </p>
          ) : (
            <p className="text-muted-foreground text-sm italic">
              No notes yet. Open it to write the spec a build session works
              from.
            </p>
          )}

          {!isShipped && item.targetDate && (
            <p className="text-muted-foreground text-xs">
              Hoping for {fmtDate(item.targetDate)} — an intention, not a
              promise.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onEdit(item)}>
              <Pencil className="size-3.5" /> Edit
            </Button>
            {isShipped && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onUnship(item)}
              >
                <Undo2 className="size-3.5" /> Un-ship
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(item)}
            >
              <Trash2 className="size-3.5" /> Delete
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export function RoadmapList({ items }: { items: TaskItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [quick, setQuick] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [confirmDelete, setConfirmDelete] = useState<TaskItem | null>(null);
  const [confirmUnship, setConfirmUnship] = useState<TaskItem | null>(null);
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

  const todo = filtered.filter((i) => i.status === "todo");
  const shipped = filtered.filter((i) => i.status === "shipped");
  const publicCount = items.filter((i) => i.isPublic).length;

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  }

  function openEdit(item: TaskItem) {
    setEditing(item);
    setForm({
      title: item.title,
      detail: item.detail ?? "",
      priority: item.priority,
      area: item.area ?? "",
      targetDate: item.targetDate ?? "",
      version: item.version ?? "",
      isPublic: item.isPublic,
    });
    setOpen(true);
  }

  /** The one-field add. Type it, press Enter, it is on the list. */
  function quickAdd() {
    const title = quick.trim();
    if (title.length < 2) return;
    startTransition(async () => {
      const res = await addRoadmapItem({ title });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setQuick("");
      router.refresh();
    });
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
      toast.success(editing ? "Saved" : "Added");
      setOpen(false);
      router.refresh();
    });
  }

  function ship(item: TaskItem) {
    startTransition(async () => {
      const res = await moveRoadmapItem({ id: item.id, status: "shipped" });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Shipped — the date and platform size are recorded");
      router.refresh();
    });
  }

  /*
   * Un-shipping asks first, and shipping does not.
   *
   * They are not the same risk. Shipping something by mistake is one tap to
   * undo. Un-shipping is what CLEARS the frozen platform size, and that number
   * cannot be worked out again later — it is how big the platform was on a day
   * that has passed.
   */
  function unship(item: TaskItem) {
    startTransition(async () => {
      const res = await unshipItem(item.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Back on the to-do list");
      setConfirmUnship(null);
      router.refresh();
    });
  }

  function remove(item: TaskItem) {
    startTransition(async () => {
      const res = await removeRoadmapItem(item.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Deleted");
      setConfirmDelete(null);
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

  const rowProps = {
    pending,
    onToggleExpanded: toggleExpanded,
    onShip: ship,
    onUnship: setConfirmUnship,
    onEdit: openEdit,
    onDelete: setConfirmDelete,
  };

  return (
    <div className="space-y-5">
      {/* Add. One field, because an idea you have to categorise is an idea you
          do not write down. Everything else can be filled in later, or never. */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Plus className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                quickAdd();
              }
            }}
            placeholder="What needs doing?"
            className="pl-9"
            enterKeyHint="done"
          />
        </div>
        <Button onClick={quickAdd} disabled={pending || quick.trim().length < 2}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : "Add"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs sm:flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="pl-9"
          />
        </div>
        <span className="text-muted-foreground text-xs">
          {todo.length} to do · {shipped.length} shipped · {publicCount} public
        </span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={openNew} disabled={pending}>
            <Plus className="size-3.5" /> With details
          </Button>
          <Button size="sm" variant="ghost" onClick={doImport} disabled={pending}>
            <Download className="size-3.5" /> Import changelog
          </Button>
        </div>
      </div>

      <section>
        <h2 className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">
          To do · {todo.length}
        </h2>
        {todo.length === 0 ? (
          <p className="text-muted-foreground mt-2 rounded-xl border border-dashed px-4 py-8 text-center text-sm">
            {query
              ? "Nothing matches that."
              : "Nothing on the list. Type above to add something."}
          </p>
        ) : (
          <ul className="mt-1">
            {todo.map((i) => (
              <Row key={i.id} item={i} isOpen={expanded.has(i.id)} {...rowProps} />
            ))}
          </ul>
        )}
      </section>

      {shipped.length > 0 && (
        <section>
          <h2 className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">
            Shipped · {shipped.length}
          </h2>
          <ul className="mt-1">
            {shipped.map((i) => (
              <Row key={i.id} item={i} isOpen={expanded.has(i.id)} {...rowProps} />
            ))}
          </ul>
        </section>
      )}

      {/* The full editor. Reached from "With details", or from a row. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit" : "Add"}</DialogTitle>
            <DialogDescription>
              The notes are the spec. Write them for whoever builds it, which
              may be a session six weeks from now with no other context.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rm-title">Title</Label>
              <Input
                id="rm-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Training: mark attendance per class meeting"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rm-detail">Notes</Label>
              <Textarea
                id="rm-detail"
                rows={7}
                value={form.detail}
                onChange={(e) => setForm({ ...form, detail: e.target.value })}
                placeholder="What it should do, and anything already in the codebase that it builds on."
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
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
                <Label htmlFor="rm-area">Area</Label>
                <Input
                  id="rm-area"
                  list="rm-areas"
                  value={form.area}
                  onChange={(e) => setForm({ ...form, area: e.target.value })}
                  placeholder="Training"
                />
                <datalist id="rm-areas">
                  {ROADMAP_AREAS.map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rm-target">Hoping for</Label>
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
                <Label htmlFor="rm-version">Shipped in version</Label>
                <Input
                  id="rm-version"
                  value={form.version}
                  onChange={(e) => setForm({ ...form, version: e.target.value })}
                  placeholder="0.69.0"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border px-4 py-3">
              <div>
                <p className="text-sm font-semibold">Show on the public roadmap</p>
                <p className="text-muted-foreground text-xs">
                  Off by default. The queue is competitive information, so each
                  item is opted in one at a time.
                </p>
              </div>
              <Switch
                checked={form.isPublic}
                onCheckedChange={(v) => setForm({ ...form, isPublic: v })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || form.title.trim().length < 2}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {editing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmUnship}
        onOpenChange={(o) => !o && setConfirmUnship(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Put this back on the to-do list?</DialogTitle>
            <DialogDescription>
              {confirmUnship?.churchesAtShip != null
                ? `This also clears the ship date, the version and the record that there were ${confirmUnship.churchesAtShip} churches and ${(confirmUnship.membersAtShip ?? 0).toLocaleString()} members the day it went out. That last part cannot be worked out again later.`
                : "This clears the ship date and the version."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmUnship(null)}>
              Keep it shipped
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmUnship && unship(confirmUnship)}
              disabled={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Un-ship
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{confirmDelete?.title}&rdquo;?</DialogTitle>
            <DialogDescription>
              Gone for good, notes and all. If you have simply decided not to do
              it, the honest record is to leave it on the list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && remove(confirmDelete)}
              disabled={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
