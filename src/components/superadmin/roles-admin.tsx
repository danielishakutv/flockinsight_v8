"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import {
  addAdmin,
  assignRole,
  deleteRole,
  removeAdmin,
  saveRole,
  searchAdminCandidates,
} from "@/app/superadmin/roles/actions";
import {
  PLATFORM_MODULES,
  ROLE_PRESETS,
  isEscalating,
} from "@/lib/platform-permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type Role = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  held: number;
};

type Admin = {
  id: string;
  name: string | null;
  email: string;
  roleId: string | null;
  roleName: string | null;
  isSelf: boolean;
};

const FULL = "__full__";

type Candidate = { id: string; name: string | null; email: string };

export function RolesAdmin({
  roles,
  admins,
  canManageAdmins,
}: {
  roles: Role[];
  admins: Admin[];
  /** Whether this admin may hand out or take away platform access at all. */
  canManageAdmins: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Role | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Adding an admin: search, pick, choose the role, all in one dialog.
  const [addOpen, setAddOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [newRole, setNewRole] = useState<string>(FULL);
  const [confirmRemove, setConfirmRemove] = useState<Admin | null>(null);

  /*
   * Debounced, and the response is dropped if the query moved on while it was
   * in flight — typing "dan" fires three searches and the slowest must not be
   * the one that wins.
   *
   * Every setState sits inside the timeout rather than the effect body: doing
   * it synchronously here cascades a render on each keystroke, which the lint
   * rule rightly refuses. A term under two characters simply schedules nothing
   * — the list below renders the hint from `q`, so there is no state to clear.
   */
  useEffect(() => {
    if (!addOpen) return;
    const term = q.trim();
    if (term.length < 2) return;
    let live = true;
    const t = setTimeout(async () => {
      if (live) setSearching(true);
      try {
        const rows = await searchAdminCandidates(term);
        if (live) setResults(rows);
      } catch {
        if (live) setResults([]);
      } finally {
        if (live) setSearching(false);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, addOpen]);

  function openAdd() {
    setQ("");
    setResults([]);
    setPicked(null);
    setNewRole(FULL);
    setAddOpen(true);
  }

  function doAdd() {
    if (!picked) return;
    start(async () => {
      const res = await addAdmin({
        userId: picked.id,
        roleId: newRole === FULL ? null : newRole,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${picked.name ?? picked.email} can now open this area.`);
      setAddOpen(false);
      router.refresh();
    });
  }

  function doRemove(a: Admin) {
    start(async () => {
      const res = await removeAdmin(a.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Admin access removed.");
      setConfirmRemove(null);
      router.refresh();
    });
  }

  function openNew() {
    setEditing(null);
    setName("");
    setDescription("");
    setPerms(new Set());
    setOpen(true);
  }

  function openEdit(r: Role) {
    setEditing(r);
    setName(r.name);
    setDescription(r.description ?? "");
    setPerms(new Set(r.permissions));
    setOpen(true);
  }

  function toggle(key: string) {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function applyPreset(p: (typeof ROLE_PRESETS)[number]) {
    setName((n) => n || p.name);
    setDescription((d) => d || p.description);
    setPerms(new Set(p.perms));
  }

  function save() {
    start(async () => {
      const res = await saveRole({
        id: editing?.id,
        name,
        description,
        permissions: [...perms],
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(editing ? "Role updated." : "Role created.");
      setOpen(false);
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await deleteRole(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Role deleted.");
      setConfirmDelete(null);
      router.refresh();
    });
  }

  function setAdminRole(a: Admin, value: string) {
    start(async () => {
      const res = await assignRole({
        userId: a.id,
        roleId: value === FULL ? null : value,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Role updated.");
      router.refresh();
    });
  }

  const escalating = [...perms].filter(isEscalating);

  return (
    <div className="space-y-6">
      {/* Roles */}
      <div className="bg-card rounded-2xl border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
          <div>
            <p className="text-sm font-bold">Roles</p>
            <p className="text-muted-foreground text-xs">
              Each role is a set of things someone may reach.
            </p>
          </div>
          <Button size="sm" onClick={openNew}>
            <Plus className="size-4" /> New role
          </Button>
        </div>

        {roles.length === 0 ? (
          <p className="text-muted-foreground p-6 text-center text-sm">
            No roles yet. Every admin has full access until you make one.
          </p>
        ) : (
          <ul className="divide-y">
            {roles.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {r.name}
                    <Badge variant="secondary">
                      {r.permissions.length} permission
                      {r.permissions.length === 1 ? "" : "s"}
                    </Badge>
                    {r.held > 0 && (
                      <Badge variant="outline">
                        {r.held} admin{r.held === 1 ? "" : "s"}
                      </Badge>
                    )}
                    {r.permissions.some(isEscalating) && (
                      <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300">
                        <ShieldAlert className="size-3" /> Can widen itself
                      </Badge>
                    )}
                  </p>
                  {r.description && (
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {r.description}
                    </p>
                  )}
                </div>
                {confirmDelete === r.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Delete it?</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={pending}
                      onClick={() => remove(r.id)}
                    >
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDelete(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirmDelete(r.id)}
                      aria-label={`Delete ${r.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Who holds what */}
      <div className="bg-card rounded-2xl border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <p className="text-sm font-bold">Admins</p>
            <p className="text-muted-foreground text-xs">
              Everyone who can open this area. Full access means no limits at
              all.
            </p>
          </div>
          {canManageAdmins && (
            <Button size="sm" onClick={openAdd}>
              <UserPlus className="size-4" />
              Add admin
            </Button>
          )}
        </div>
        <ul className="divide-y">
          {admins.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {a.name ?? a.email}
                  {a.isSelf && (
                    <span className="text-muted-foreground ml-2 text-xs font-normal">
                      (you)
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground truncate text-xs">{a.email}</p>
              </div>
              {a.isSelf ? (
                /*
                  Changing your own role here would let you remove the very
                  permission that lets you change it back, and the only way out
                  of that is the database.
                */
                <span className="text-muted-foreground text-xs">
                  {a.roleName ?? "Full access"} · ask another admin to change
                  yours
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <Select
                    value={a.roleId ?? FULL}
                    onValueChange={(v) => setAdminRole(a, v)}
                  >
                    <SelectTrigger className="w-52">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={FULL}>Full access</SelectItem>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {canManageAdmins && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirmRemove(a)}
                      aria-label={`Remove admin access from ${a.name ?? a.email}`}
                    >
                      <UserMinus className="size-4" />
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Editor */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "New role"}</DialogTitle>
            <DialogDescription>
              Tick what this role may reach. Anything not ticked is invisible to
              them — the menu hides it too.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Support"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-desc">What it is for</Label>
              <Input
                id="role-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Answer churches and look things up"
              />
            </div>
          </div>

          {!editing && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">Start from:</span>
              {ROLE_PRESETS.map((p) => (
                <Button
                  key={p.name}
                  size="sm"
                  variant="outline"
                  onClick={() => applyPreset(p)}
                >
                  {p.name}
                </Button>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {PLATFORM_MODULES.map((m) => (
              <div key={m.key} className="rounded-xl border p-3">
                <p className="text-sm font-semibold">{m.label}</p>
                <p className="text-muted-foreground text-xs">{m.description}</p>
                <div className="mt-2 space-y-1.5">
                  {m.perms.map((p) => (
                    <label
                      key={p.key}
                      className="flex cursor-pointer items-start gap-2.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={perms.has(p.key)}
                        onChange={() => toggle(p.key)}
                        className="mt-0.5 size-4 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="font-medium">
                          {p.label}
                          {isEscalating(p.key) && (
                            <ShieldAlert className="ml-1 inline size-3.5 text-amber-600 dark:text-amber-400" />
                          )}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {p.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {escalating.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p>
                <span className="font-semibold">
                  This role can widen its own access.
                </span>{" "}
                Managing roles lets them write themselves a new one; managing
                accounts lets them reset an owner&apos;s password and become
                them; restoring a backup rewrites the roles table. Treat it as
                full access in all but name.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !name.trim()}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {editing ? "Save changes" : "Create role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add an admin */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add an admin</DialogTitle>
            <DialogDescription>
              Find an account that already exists and say what it may do. This
              is not an invitation — the person already has a FlockInsight
              login; this opens the admin area to it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="admin-search">Search by name or email</Label>
              <div className="relative">
                <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  id="admin-search"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPicked(null);
                  }}
                  placeholder="name or email"
                  className="pl-9"
                  autoComplete="off"
                />
              </div>
            </div>

            {picked ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {picked.name ?? picked.email}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {picked.email}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPicked(null)}
                >
                  Change
                </Button>
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-xl border">
                {searching ? (
                  <p className="text-muted-foreground p-3 text-sm">
                    Searching…
                  </p>
                ) : q.trim().length < 2 ? (
                  <p className="text-muted-foreground p-3 text-sm">
                    Type at least two characters.
                  </p>
                ) : results.length === 0 ? (
                  <p className="text-muted-foreground p-3 text-sm">
                    Nobody matches. Anyone who is already an admin is on the
                    list behind this dialog, not in here.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {results.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="hover:bg-muted w-full p-3 text-left"
                          onClick={() => setPicked(c)}
                        >
                          <span className="block truncate font-medium">
                            {c.name ?? c.email}
                          </span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {c.email}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="admin-role">Role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger id="admin-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FULL}>Full access</SelectItem>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {newRole === FULL && (
                <p className="text-muted-foreground text-xs">
                  Full access has no limits at all — billing, backups, other
                  admins. Choose a role unless they genuinely need everything.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={doAdd} disabled={pending || !picked}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Give admin access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Take it away */}
      <Dialog
        open={!!confirmRemove}
        onOpenChange={(o) => !o && setConfirmRemove(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove admin access?</DialogTitle>
            <DialogDescription>
              {confirmRemove?.name ?? confirmRemove?.email} keeps their
              FlockInsight account and everything they do in their own church.
              They lose this area, and their role here is cleared rather than
              remembered — so giving it back later is a fresh decision.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRemove && doRemove(confirmRemove)}
              disabled={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Remove access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
