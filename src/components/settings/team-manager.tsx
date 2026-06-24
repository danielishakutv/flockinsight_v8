"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Lock, Mail, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { organization } from "@/lib/auth-client";
import { assignRole } from "@/app/(app)/settings/roles/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Member = {
  memberId: string;
  role: string;
  roleId: string | null;
  userId: string;
  name: string;
  email: string;
};
type Invite = { id: string; email: string; role: string | null };
type Role = { id: string; name: string };

const NO_ROLE = "__none__";

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function TeamManager({
  members,
  invites,
  roles,
  currentUserId,
}: {
  members: Member[];
  invites: Invite[];
  roles: Role[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");

  function invite(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const { error } = await organization.inviteMember({
        email: email.trim(),
        role: inviteRole as "member" | "admin",
      });
      if (error) {
        toast.error(error.message || "Could not send invitation.");
        return;
      }
      toast.success(`Invitation created for ${email.trim()}`);
      setEmail("");
      router.refresh();
    });
  }

  function cancelInvite(id: string) {
    startTransition(async () => {
      const { error } = await organization.cancelInvitation({
        invitationId: id,
      });
      if (error) {
        toast.error(error.message || "Could not cancel.");
        return;
      }
      toast.success("Invitation cancelled");
      router.refresh();
    });
  }

  function removeMember(m: Member) {
    startTransition(async () => {
      const { error } = await organization.removeMember({
        memberIdOrEmail: m.email,
      });
      if (error) {
        toast.error(error.message || "Could not remove member.");
        return;
      }
      toast.success(`${m.name} removed`);
      router.refresh();
    });
  }

  function changeRole(m: Member, value: string) {
    startTransition(async () => {
      const res = await assignRole(m.memberId, value === NO_ROLE ? null : value);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Role updated for ${m.name}`);
      router.refresh();
    });
  }

  function copyInviteLink(id: string) {
    const url = `${window.location.origin}/accept-invitation/${id}`;
    navigator.clipboard.writeText(url);
    toast.success("Invite link copied");
  }

  return (
    <div className="space-y-6">
      {/* Invite */}
      <Card>
        <CardContent>
          <form onSubmit={invite} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Invite by email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="person@church.org"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">Access</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger id="invite-role" className="w-full sm:w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" size="lg" disabled={pending}>
                {pending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <UserPlus className="size-5" />
                )}
                Invite
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              We email them an invitation link — or use “Copy link” below to
              share it directly. After they accept, give them a specific role.
            </p>
          </form>
        </CardContent>
      </Card>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div>
          <h2 className="text-muted-foreground mb-2 px-1 text-xs font-bold tracking-wider uppercase">
            Pending invitations
          </h2>
          <div className="space-y-2">
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="bg-card flex items-center gap-3 rounded-2xl border p-3"
              >
                <div className="bg-muted text-muted-foreground grid size-10 place-items-center rounded-full">
                  <Mail className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{inv.email}</p>
                  <p className="text-muted-foreground text-xs capitalize">
                    {inv.role ?? "member"} · pending
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyInviteLink(inv.id)}
                >
                  <Copy className="size-4" />
                  Copy link
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Cancel invitation"
                  onClick={() => cancelInvite(inv.id)}
                  disabled={pending}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Members */}
      <div>
        <h2 className="text-muted-foreground mb-2 px-1 text-xs font-bold tracking-wider uppercase">
          Team members ({members.length})
        </h2>
        <div className="space-y-2">
          {members.map((m) => {
            const isOwner = m.role === "owner";
            const isSelf = m.userId === currentUserId;
            return (
              <div
                key={m.memberId}
                className="bg-card flex flex-wrap items-center gap-3 rounded-2xl border p-3"
              >
                <Avatar className="size-10">
                  <AvatarFallback className="bg-primary/15 text-primary font-bold">
                    {initials(m.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {m.name}
                    {isSelf && (
                      <span className="text-muted-foreground"> (you)</span>
                    )}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {m.email}
                  </p>
                </div>

                {isOwner ? (
                  <Badge className="gap-1">
                    <Lock className="size-3" />
                    Owner
                  </Badge>
                ) : (
                  <Select
                    value={m.roleId ?? NO_ROLE}
                    onValueChange={(v) => changeRole(m, v)}
                    disabled={pending || isSelf}
                  >
                    <SelectTrigger className="w-40" aria-label="Role">
                      <SelectValue placeholder="No role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ROLE}>No role</SelectItem>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {!isOwner && !isSelf && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove member"
                    onClick={() => removeMember(m)}
                    disabled={pending}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
