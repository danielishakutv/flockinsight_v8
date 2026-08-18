"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft,
  Building2,
  Copy,
  KeyRound,
  Loader2,
  Mail,
  Plus,
  Shield,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  assignUserToChurch,
  deleteUser,
  removeUserFromChurch,
  resetUserPasswordAction,
  sendResetLink,
  setSuperAdmin,
  setUserPasswordAction,
  updateUser,
} from "@/app/superadmin/users/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type UserInfo = {
  id: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  emailVerified: boolean;
  createdAt: string;
};
type Membership = { churchId: string; churchName: string; role: string };

const ROLES = ["owner", "admin", "member"] as const;

export function UserDetail({
  currentAdminId,
  user,
  memberships,
  churches,
}: {
  currentAdminId: string;
  user: UserInfo;
  memberships: Membership[];
  churches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [pw, setPw] = useState("");
  const [forceChange, setForceChange] = useState(true);
  const [tempPw, setTempPw] = useState<string | null>(null);
  const [assignChurch, setAssignChurch] = useState("");
  const [assignRole, setAssignRole] = useState<(typeof ROLES)[number]>("member");

  const isSelf = user.id === currentAdminId;
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Something went wrong");
      toast.success(ok);
      router.refresh();
    });

  function saveProfile() {
    run(() => updateUser(user.id, { name, email }), "Profile updated");
  }
  function toggleAdmin() {
    run(() => setSuperAdmin(user.id, !user.isSuperAdmin), "Updated");
  }
  function setPassword() {
    if (pw.length < 8) return toast.error("Password must be at least 8 characters.");
    start(async () => {
      const res = await setUserPasswordAction(user.id, pw, forceChange);
      if (!res.ok) return void toast.error(res.error);
      setPw("");
      toast.success("Password set");
      router.refresh();
    });
  }
  function resetTemp() {
    if (!confirm("Reset to a temporary password and email it to the user?")) return;
    start(async () => {
      const res = await resetUserPasswordAction(user.id);
      if (!res.ok) return void toast.error(res.error);
      setTempPw(res.tempPassword);
      toast.success(res.emailed ? "Temp password emailed" : "Temp password generated");
      router.refresh();
    });
  }
  function resetLink() {
    run(() => sendResetLink(user.id), "Reset link emailed");
  }
  function assign() {
    if (!assignChurch) return toast.error("Pick a church.");
    run(
      () => assignUserToChurch(user.id, assignChurch, assignRole),
      "Church assigned",
    );
    setAssignChurch("");
  }
  function changeRole(churchId: string, role: (typeof ROLES)[number]) {
    run(() => assignUserToChurch(user.id, churchId, role), "Role updated");
  }
  function removeChurch(m: Membership) {
    if (!confirm(`Remove ${user.name} from ${m.churchName}?`)) return;
    run(() => removeUserFromChurch(user.id, m.churchId), "Removed from church");
  }
  function destroy() {
    if (!confirm(`Permanently delete ${user.email}? This cannot be undone.`)) return;
    start(async () => {
      const res = await deleteUser(user.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("User deleted");
      router.push("/superadmin/users");
    });
  }

  const assignable = churches.filter(
    (c) => !memberships.some((m) => m.churchId === c.id),
  );

  return (
    <div className="max-w-2xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/superadmin/users">
          <ArrowLeft className="size-4" /> All users
        </Link>
      </Button>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold tracking-tight">{user.name}</h1>
        {user.isSuperAdmin && (
          <Badge className="gap-1">
            <Shield className="size-3" /> Admin
          </Badge>
        )}
        {user.mustChangePassword && <Badge variant="secondary">Must reset</Badge>}
        {!user.emailVerified && <Badge variant="outline">Unverified</Badge>}
      </div>
      <p className="text-muted-foreground -mt-4 text-sm">
        Joined {format(parseISO(user.createdAt), "MMM d, yyyy")}
      </p>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="u-name">Name</Label>
              <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-email">Email</Label>
              <Input
                id="u-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={saveProfile} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save profile
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Access */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Platform access</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Superadmin</p>
            <p className="text-muted-foreground text-xs">
              Full platform access. {isSelf && "You can't change your own."}
            </p>
          </div>
          <Button
            variant={user.isSuperAdmin ? "outline" : "default"}
            onClick={toggleAdmin}
            disabled={pending || (isSelf && user.isSuperAdmin)}
          >
            {user.isSuperAdmin ? "Revoke admin" : "Make admin"}
          </Button>
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="text-primary size-5" /> Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="u-pw">Set a specific password</Label>
            <div className="flex flex-wrap gap-2">
              <PasswordInput
                id="u-pw"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                className="min-w-[12rem] flex-1"
              />
              <Button onClick={setPassword} disabled={pending || pw.length < 8}>
                Set password
              </Button>
            </div>
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={forceChange}
                onChange={(e) => setForceChange(e.target.checked)}
              />
              Require the user to change it on next login
            </label>
          </div>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button variant="outline" onClick={resetTemp} disabled={pending}>
              <KeyRound className="size-4" /> Reset to temp password
            </Button>
            <Button variant="outline" onClick={resetLink} disabled={pending}>
              <Mail className="size-4" /> Send reset link
            </Button>
          </div>

          {tempPw && (
            <div className="bg-muted flex items-center justify-between gap-3 rounded-xl border p-3">
              <div>
                <p className="text-muted-foreground text-xs">Temporary password</p>
                <code className="text-lg font-bold">{tempPw}</code>
              </div>
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
          )}
        </CardContent>
      </Card>

      {/* Churches */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="text-primary size-5" /> Churches
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {memberships.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Not a member of any church.
            </p>
          ) : (
            memberships.map((m) => (
              <div
                key={m.churchId}
                className="flex flex-wrap items-center gap-2 rounded-xl border p-3"
              >
                <Link
                  href={`/superadmin/churches/${m.churchId}`}
                  className="text-primary min-w-0 flex-1 truncate font-semibold hover:underline"
                >
                  {m.churchName}
                </Link>
                <Select
                  value={m.role}
                  onValueChange={(v) => changeRole(m.churchId, v as (typeof ROLES)[number])}
                >
                  <SelectTrigger className="h-9 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r} className="capitalize">
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeChurch(m)}
                  disabled={pending}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}

          {/* Assign to a church */}
          <div className="flex flex-wrap items-end gap-2 border-t pt-3">
            <div className="min-w-[12rem] flex-1 space-y-1">
              <Label className="text-xs">Add to a church</Label>
              <Select value={assignChurch} onValueChange={setAssignChurch}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a church" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {assignable.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Select value={assignRole} onValueChange={(v) => setAssignRole(v as (typeof ROLES)[number])}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={assign} disabled={pending || !assignChurch}>
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Danger */}
      {!isSelf && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive text-lg">Danger zone</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              Permanently delete this account and its memberships. Churches they
              own will remain but lose this owner.
            </p>
            <Button variant="destructive" onClick={destroy} disabled={pending}>
              <Trash2 className="size-4" /> Delete user
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
