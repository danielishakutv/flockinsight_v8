"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { inviteMemberAsStaff } from "@/app/(app)/members/access-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AccessRole = { id: string; name: string; description: string | null };

const NO_ROLE = "__none__";

/**
 * Turns a congregation member into a staff member with a login.
 *
 * Only the church role is asked for — the Better Auth org role is derived from
 * its permissions server-side, so the two can't drift apart.
 */
export function GiveAccessDialog({
  open,
  onOpenChange,
  member,
  roles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: { id: string; name: string; email: string | null };
  roles: AccessRole[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState<string>(NO_ROLE);

  const hasEmail = !!member.email?.trim();
  const selectedRole = roles.find((r) => r.id === roleId) ?? null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await inviteMemberAsStaff({
        memberId: member.id,
        roleId: roleId === NO_ROLE ? null : roleId,
        email: hasEmail ? undefined : email.trim(),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Invitation sent to ${hasEmail ? member.email : email.trim()}`,
      );
      onOpenChange(false);
      setEmail("");
      setRoleId(NO_ROLE);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="bg-primary/10 text-primary mb-1 grid size-11 place-items-center rounded-full">
            <ShieldCheck className="size-5" />
          </div>
          <DialogTitle>Give {member.name} app access</DialogTitle>
          <DialogDescription>
            They&apos;ll get an email invitation to create a login. Their member
            profile stays exactly as it is — no duplicate record.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {hasEmail ? (
            <div className="space-y-1">
              <Label>Invitation goes to</Label>
              <p className="bg-muted rounded-lg px-3 py-2 text-sm font-medium">
                {member.email}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="access-email">Email address</Label>
              <Input
                id="access-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="person@church.org"
              />
              <p className="text-muted-foreground text-xs">
                {member.name} has no email on file. We&apos;ll save this to their
                profile and send the invitation there.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="access-role">Role</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger id="access-role" className="w-full">
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ROLE}>No role yet</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {selectedRole?.description ||
                (roleId === NO_ROLE
                  ? "They'll sign in with basic access until you assign a role."
                  : "This role decides what they can see and do.")}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
