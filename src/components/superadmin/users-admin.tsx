"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Loader2, Search, Shield, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import {
  resetUserPasswordAction,
  setSuperAdmin,
} from "@/app/superadmin/users/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  churches: string;
};

export function UsersAdmin({
  users,
  currentAdminId,
}: {
  users: UserRow[];
  currentAdminId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const [tempPw, setTempPw] = useState("");
  const [emailed, setEmailed] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.name, u.email, u.churches].some((v) => v.toLowerCase().includes(q)),
    );
  }, [users, query]);

  function reset(u: UserRow) {
    if (!confirm(`Reset the password for ${u.email}? They'll get a temporary one by email.`))
      return;
    setBusyId(u.id);
    start(async () => {
      const res = await resetUserPasswordAction(u.id);
      setBusyId(null);
      if (!res.ok) return void toast.error(res.error);
      setResetFor(u);
      setTempPw(res.tempPassword);
      setEmailed(res.emailed);
      router.refresh();
    });
  }

  function toggleAdmin(u: UserRow) {
    const make = !u.isSuperAdmin;
    if (!confirm(make ? `Make ${u.email} a superadmin?` : `Remove superadmin from ${u.email}?`))
      return;
    setBusyId(u.id);
    start(async () => {
      const res = await setSuperAdmin(u.id, make);
      setBusyId(null);
      if (!res.ok) return void toast.error(res.error);
      toast.success(make ? "Superadmin granted" : "Superadmin removed");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email or church"
          className="pl-9"
        />
      </div>

      <div className="space-y-2">
        {filtered.map((u) => {
          const busy = busyId === u.id && pending;
          return (
            <Card key={u.id}>
              <CardContent className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-semibold">{u.name}</p>
                    {u.isSuperAdmin && (
                      <Badge variant="default" className="gap-1">
                        <Shield className="size-3" /> Admin
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    {u.email}
                    {u.churches ? ` · ${u.churches}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => reset(u)} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                  Reset password
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => toggleAdmin(u)}
                  disabled={busy || (u.isSuperAdmin && u.id === currentAdminId)}
                  title={u.isSuperAdmin ? "Remove superadmin" : "Make superadmin"}
                >
                  {u.isSuperAdmin ? <ShieldOff className="size-4" /> : <Shield className="size-4" />}
                </Button>
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">No users found.</p>
        )}
      </div>

      <Dialog open={resetFor !== null} onOpenChange={(o) => !o && setResetFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password reset</DialogTitle>
            <DialogDescription>
              {emailed
                ? `A temporary password was emailed to ${resetFor?.email}.`
                : `Couldn't send the email — share this temporary password with ${resetFor?.email} securely.`}
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted flex items-center justify-between gap-3 rounded-xl border p-3">
            <code className="text-lg font-bold">{tempPw}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(tempPw);
                toast.success("Copied");
              }}
            >
              <Copy className="size-4" /> Copy
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            They&apos;ll be asked to set a new password right after logging in.
          </p>
          <DialogFooter>
            <Button onClick={() => setResetFor(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
