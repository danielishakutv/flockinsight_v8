"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Pencil, Plus, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createRole,
  updateRole,
  deleteRole,
  grantNewPermissions,
} from "@/app/(app)/settings/roles/actions";
import { ALL_PERMISSIONS, PERMISSION_CATALOG } from "@/lib/permissions-catalog";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  members: number;
};

const TOTAL_PERMS = PERMISSION_CATALOG.reduce((n, m) => n + m.perms.length, 0);

/** Permissions in today's catalogue that a role does not hold. */
function missingFor(r: RoleRow): string[] {
  return ALL_PERMISSIONS.filter((p) => !r.permissions.includes(p));
}

/** Those permissions as module names, which is what an admin recognises. */
function missingModules(r: RoleRow): string[] {
  const missing = new Set(missingFor(r));
  return PERMISSION_CATALOG.filter((m) =>
    m.perms.some((p) => missing.has(p.key)),
  ).map((m) => m.label);
}

export function RolesManager({ roles }: { roles: RoleRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function grantNew(id: string) {
    startTransition(async () => {
      const res = await grantNewPermissions(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("New permissions granted");
      router.refresh();
    });
  }

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [perms, setPerms] = useState<Set<string>>(new Set());

  function openAdd() {
    setEditing(null);
    setName("");
    setDescription("");
    setPerms(new Set());
    setOpen(true);
  }
  function openEdit(r: RoleRow) {
    setEditing(r);
    setName(r.name);
    setDescription(r.description ?? "");
    setPerms(new Set(r.permissions));
    setOpen(true);
  }

  function togglePerm(key: string, on: boolean) {
    setPerms((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(key);
        // Granting Manage implies View for the same module.
        if (key.endsWith(".manage")) next.add(key.replace(".manage", ".view"));
      } else {
        next.delete(key);
        // Removing View also removes Manage.
        if (key.endsWith(".view")) next.delete(key.replace(".view", ".manage"));
      }
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        permissions: [...perms],
      };
      try {
        const res = editing
          ? await updateRole({ id: editing.id, ...payload })
          : await createRole(payload);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(editing ? "Role updated" : "Role created");
        setOpen(false);
        router.refresh();
      } catch {
        toast.error("Couldn't reach the server. Check your connection and try again.");
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      try {
        const res = await deleteRole(id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Role deleted");
        setConfirmId(null);
        router.refresh();
      } catch {
        toast.error("Couldn't reach the server. Check your connection and try again.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Create roles and choose exactly what each can see and do, then assign
          them on the Team tab.
        </p>
        <Button onClick={openAdd} size="lg" className="shrink-0">
          <Plus className="size-5" />
          New role
        </Button>
      </div>

      <div className="space-y-2">
        {roles.map((r) => {
          const permCount = r.isSystem ? TOTAL_PERMS : r.permissions.length;
          return (
            <div
              key={r.id}
              className="bg-card flex items-center gap-3 rounded-2xl border p-3 shadow-sm sm:p-4"
            >
              <div
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-xl",
                  r.isSystem
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {r.isSystem ? (
                  <Lock className="size-5" />
                ) : (
                  <Shield className="size-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold">{r.name}</p>
                  {r.isSystem && <Badge variant="secondary">Locked</Badge>}
                </div>
                <p className="text-muted-foreground truncate text-xs">
                  {r.isSystem
                    ? "Full access"
                    : `${permCount} permission${permCount === 1 ? "" : "s"}`}
                  {" · "}
                  {r.members} member{r.members === 1 ? "" : "s"}
                </p>
                {/*
                  A role stores a fixed list of permission keys, so one written
                  before a module shipped can never see that module — and until
                  now nothing said so. Modules simply looked missing.
                */}
                {!r.isSystem && missingFor(r).length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5">
                    <p className="text-[11px] leading-snug">
                      <span className="font-bold">
                        {missingModules(r).length} newer{" "}
                        {missingModules(r).length === 1 ? "module" : "modules"}
                      </span>{" "}
                      not in this role:{" "}
                      <span className="text-muted-foreground">
                        {missingModules(r).join(", ")}
                      </span>
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 text-[11px]"
                      onClick={() => grantNew(r.id)}
                      disabled={pending}
                    >
                      Add them
                    </Button>
                  </div>
                )}
              </div>

              {!r.isSystem && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit role"
                    onClick={() => openEdit(r)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  {confirmId === r.id ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => remove(r.id)}
                      disabled={pending}
                    >
                      {pending ? <Loader2 className="animate-spin" /> : "Confirm"}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete role"
                      onClick={() => setConfirmId(r.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{editing ? "Edit role" : "New role"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role-name">Role name</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Treasurer, Usher, Pastor"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-desc">Description</Label>
              <Input
                id="role-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-3">
              <Label>Permissions</Label>
              {PERMISSION_CATALOG.map((mod) => (
                <div
                  key={mod.key}
                  className="rounded-xl border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{mod.label}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {mod.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {mod.perms.map((p) => {
                        const on = perms.has(p.key);
                        return (
                          <button
                            key={p.key}
                            type="button"
                            onClick={() => togglePerm(p.key, !on)}
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                              on
                                ? "border-primary bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-accent",
                            )}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !name.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              {editing ? "Save role" : "Create role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
