"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Copy, KeyRound, Loader2, Shield } from "lucide-react";
import { toast } from "sonner";
import { resetUserPasswordAction } from "@/app/superadmin/users/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminChips, AdminSearch, RowActions } from "@/components/superadmin/list-kit";
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

export function UsersAdmin({ users }: { users: UserRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "admins" | "nochurch">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const [tempPw, setTempPw] = useState("");
  const [emailed, setEmailed] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (filter === "admins" && !u.isSuperAdmin) return false;
      if (filter === "nochurch" && u.churches) return false;
      if (q && ![u.name, u.email, u.churches].some((v) => v.toLowerCase().includes(q)))
        return false;
      return true;
    });
  }, [users, query, filter]);

  const FILTERS = [
    { key: "all", label: "All", count: users.length },
    { key: "admins", label: "Superadmins", count: users.filter((u) => u.isSuperAdmin).length },
    { key: "nochurch", label: "No church", count: users.filter((u) => !u.churches).length },
  ] as const;

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

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <AdminSearch
          value={query}
          onChange={setQuery}
          placeholder="Search by name, email or church"
        />
        <AdminChips
          label="Filter users"
          value={filter}
          onChange={setFilter}
          options={FILTERS}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {filtered.map((u) => {
          const busy = busyId === u.id && pending;
          return (
            <article
              key={u.id}
              className="bg-card flex min-w-0 flex-col overflow-hidden rounded-xl border"
            >
              <Link
                href={`/superadmin/users/${u.id}`}
                className="group hover:bg-accent/40 flex flex-1 items-start gap-2 p-4 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="group-hover:text-primary text-base leading-snug font-semibold break-words transition-colors">
                    {u.name}
                  </h3>
                  {u.isSuperAdmin && (
                    <Badge variant="default" className="mt-1.5 gap-1">
                      <Shield className="size-3" /> Admin
                    </Badge>
                  )}
                  <p className="text-muted-foreground mt-1.5 truncate text-xs">{u.email}</p>
                  {u.churches && (
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                      {u.churches}
                    </p>
                  )}
                </div>
                <ChevronRight className="text-muted-foreground mt-0.5 size-5 shrink-0" />
              </Link>
              <RowActions moreLabel={`More actions for ${u.name}`}>
                <Button size="sm" variant="outline" onClick={() => reset(u)} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                  Reset password
                </Button>
                <Button asChild size="sm">
                  <Link href={`/superadmin/users/${u.id}`}>
                    Manage <ChevronRight className="size-4" />
                  </Link>
                </Button>
              </RowActions>
            </article>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm xl:col-span-2">
            No users found.
          </p>
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
                // A temporary password. Only claim it copied once it has —
                // otherwise whoever is sending it pastes the clipboard's
                // previous contents. It is on screen beside this button.
                navigator.clipboard.writeText(tempPw).then(
                  () => toast.success("Copied"),
                  (e: unknown) => {
                    console.error("clipboard write failed", e);
                    toast.error("Couldn't copy — select it and copy by hand.");
                  },
                );
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
