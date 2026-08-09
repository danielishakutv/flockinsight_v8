"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  Loader2,
  MailCheck,
  ShieldCheck,
  ShieldOff,
  TriangleAlert,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import {
  cancelMemberInvite,
  revokeMemberAccess,
} from "@/app/(app)/members/access-actions";
import {
  GiveAccessDialog,
  type AccessRole,
} from "@/components/members/give-access-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Whether this member can sign in, and how. */
export type MemberAccess =
  | { state: "none" }
  | { state: "active"; roleName: string | null; isOwner: boolean }
  | { state: "invited"; email: string; invitationId: string };

export function MemberAccessCard({
  member,
  access,
  roles,
}: {
  member: { id: string; name: string; email: string | null };
  access: MemberAccess;
  roles: AccessRole[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  function revoke() {
    start(async () => {
      const res = await revokeMemberAccess(member.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${member.name} can no longer sign in`);
      setConfirmRevoke(false);
      router.refresh();
    });
  }

  function cancelInvite() {
    start(async () => {
      const res = await cancelMemberInvite(member.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Invitation cancelled");
      router.refresh();
    });
  }

  function copyLink(invitationId: string) {
    navigator.clipboard.writeText(
      `${window.location.origin}/accept-invitation/${invitationId}`,
    );
    toast.success("Invite link copied");
  }

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <span
            className={
              access.state === "active"
                ? "bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-xl"
                : "bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-xl"
            }
          >
            {access.state === "active" ? (
              <ShieldCheck className="size-5" />
            ) : access.state === "invited" ? (
              <MailCheck className="size-5" />
            ) : (
              <ShieldOff className="size-5" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            {access.state === "active" && (
              <>
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  Has app access
                  {access.isOwner ? (
                    <Badge variant="default">Owner</Badge>
                  ) : access.roleName ? (
                    <Badge variant="secondary">{access.roleName}</Badge>
                  ) : (
                    <Badge variant="outline">No role assigned</Badge>
                  )}
                </p>
                <p className="text-muted-foreground text-xs">
                  {access.isOwner
                    ? "This is the church owner — their access can't be removed."
                    : "They can sign in to this church."}
                </p>
              </>
            )}

            {access.state === "invited" && (
              <>
                <p className="font-bold">Invitation sent</p>
                <p className="text-muted-foreground truncate text-xs">
                  Waiting for {access.email} to accept.
                </p>
              </>
            )}

            {access.state === "none" && (
              <>
                <p className="font-bold">No app access</p>
                <p className="text-muted-foreground text-xs">
                  Invite them to sign in and give them a role.
                </p>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {access.state === "none" && (
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                <UserPlus className="size-4" />
                Give app access
              </Button>
            )}

            {access.state === "invited" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyLink(access.invitationId)}
                >
                  <Copy className="size-4" />
                  Copy link
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={cancelInvite}
                  disabled={pending}
                >
                  {pending && <Loader2 className="animate-spin" />}
                  Cancel
                </Button>
              </>
            )}

            {access.state === "active" && !access.isOwner && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmRevoke(true)}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <ShieldOff className="size-4" />
                Remove access
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <GiveAccessDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        member={member}
        roles={roles}
      />

      <Dialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <DialogContent>
          <DialogHeader>
            <div className="bg-destructive/10 text-destructive mb-1 grid size-11 place-items-center rounded-full">
              <TriangleAlert className="size-5" />
            </div>
            <DialogTitle>Remove {member.name}&apos;s access?</DialogTitle>
            <DialogDescription>
              They will no longer be able to sign in. Their member profile,
              attendance and giving records are all kept — this removes a login,
              not a person.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmRevoke(false)}
              disabled={pending}
            >
              Keep access
            </Button>
            <Button variant="destructive" onClick={revoke} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Remove access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
