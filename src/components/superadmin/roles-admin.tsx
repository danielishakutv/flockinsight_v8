"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  assignRole,
  deleteRole,
  saveRole,
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

export function RolesAdmin({
  roles,
  admins,
}: {
  roles: Role[];
  admins: Admin[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Role | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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
        <div className="border-b p-4">
          <p className="text-sm font-bold">Admins</p>
          <p className="text-muted-foreground text-xs">
            Everyone who can open this area. Full access means no limits at all.
          </p>
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
    </div>
  );
}
