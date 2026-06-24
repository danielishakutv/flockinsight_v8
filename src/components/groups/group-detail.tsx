"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarClock,
  Check,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Tag,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  addMembersToGroup,
  removeMemberFromGroup,
  setMembershipLeader,
  setMembershipRole,
} from "@/app/(app)/groups/actions";
import {
  GroupFormDialog,
  type GroupFormValue,
} from "@/components/groups/group-form-dialog";
import {
  TYPE_LABEL,
  TYPE_VARIANT,
  meetingLabel,
  type GroupType,
} from "@/components/groups/labels";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type GroupMemberRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: "active" | "inactive" | "visitor" | "new_convert";
  isLeader: boolean;
  role: string | null;
};

type Candidate = { id: string; name: string };

type GroupInfo = {
  id: string;
  name: string;
  type: GroupType;
  description: string | null;
  meetingDay: number | null;
  meetingTime: string | null;
  isActive: boolean;
};

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export function GroupDetail({
  group,
  members,
  candidates,
  canManage = true,
}: {
  group: GroupInfo;
  members: GroupMemberRow[];
  candidates: Candidate[];
  canManage?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const meets = meetingLabel(group.meetingDay, group.meetingTime);

  const emails = useMemo(
    () => members.map((m) => m.email).filter(Boolean) as string[],
    [members],
  );
  const phones = useMemo(
    () => members.map((m) => m.phone).filter(Boolean) as string[],
    [members],
  );

  async function copy(values: string[], label: string) {
    if (values.length === 0) {
      toast.error(`No ${label} to copy.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(values.join(", "));
      toast.success(`Copied ${values.length} ${label}`);
    } catch {
      toast.error("Couldn't access the clipboard.");
    }
  }

  function remove(memberId: string) {
    startTransition(async () => {
      const res = await removeMemberFromGroup(group.id, memberId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Removed from group");
      router.refresh();
    });
  }

  const initialForm: GroupFormValue = {
    id: group.id,
    name: group.name,
    type: group.type,
    description: group.description,
    leaderId: null, // leadership is managed per-member, below
    meetingDay: group.meetingDay,
    meetingTime: group.meetingTime,
    isActive: group.isActive,
  };

  const leaderCount = members.filter((m) => m.isLeader).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardContent className="py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold tracking-tight">
                  {group.name}
                </h1>
                <Badge variant={TYPE_VARIANT[group.type]}>
                  {TYPE_LABEL[group.type]}
                </Badge>
                {!group.isActive && <Badge variant="outline">Inactive</Badge>}
              </div>
              {group.description && (
                <p className="text-muted-foreground mt-2 text-sm">
                  {group.description}
                </p>
              )}
              <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <UsersRound className="size-4" />
                  {members.length} member{members.length === 1 ? "" : "s"}
                </span>
                {leaderCount > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="size-4" />
                    {leaderCount} leader{leaderCount === 1 ? "" : "s"}
                  </span>
                )}
                {meets && (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarClock className="size-4" />
                    {meets}
                  </span>
                )}
              </div>
            </div>
            {canManage && (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" />
                Edit
              </Button>
            )}
          </div>

          {/* Communication helpers */}
          <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => copy(emails, "emails")}
            >
              <Mail className="size-4" />
              Copy emails ({emails.length})
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => copy(phones, "phone numbers")}
            >
              <Phone className="size-4" />
              Copy phone numbers ({phones.length})
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-lg">Members</CardTitle>
          {canManage && (
            <Button onClick={() => setAddOpen(true)} size="sm">
              <Plus className="size-4" />
              Add members
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="bg-primary/10 text-primary grid size-12 place-items-center rounded-2xl">
                <UserRound className="size-6" />
              </div>
              <p className="text-muted-foreground text-sm">
                No members yet. Add people from your congregation.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <MemberRow
                  key={m.id}
                  groupId={group.id}
                  member={m}
                  busy={pending}
                  canManage={canManage}
                  onRemove={() => remove(m.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <GroupFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={initialForm}
        candidates={candidates}
      />

      <AddMembersDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        groupId={group.id}
        candidates={candidates}
        existingIds={new Set(members.map((m) => m.id))}
      />
    </div>
  );
}

function MemberRow({
  groupId,
  member,
  busy,
  canManage,
  onRemove,
}: {
  groupId: string;
  member: GroupMemberRow;
  busy: boolean;
  canManage: boolean;
  onRemove: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [leaderPending, startLeader] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(member.role ?? "");
  const [confirm, setConfirm] = useState(false);

  function saveRole() {
    const next = draft.trim() || null;
    if (next === (member.role ?? null)) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const res = await setMembershipRole(groupId, member.id, next);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function toggleLeader() {
    startLeader(async () => {
      const res = await setMembershipLeader(
        groupId,
        member.id,
        !member.isLeader,
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        member.isLeader ? "Removed as leader" : "Marked as leader",
      );
      router.refresh();
    });
  }

  return (
    <div
      className={
        "flex items-center gap-3 rounded-xl border p-2.5 " +
        (member.isLeader ? "border-primary/40 bg-primary/5" : "")
      }
    >
      <Link
        href={`/members/${member.id}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <Avatar className="size-10">
          <AvatarFallback className="bg-primary/15 text-primary text-sm font-bold">
            {initials(member.name) || "?"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate font-semibold">{member.name}</p>
            {member.isLeader && (
              <Badge className="shrink-0 gap-1">
                <ShieldCheck className="size-3" />
                Leader
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground truncate text-xs">
            {member.phone || member.email || "No contact"}
          </p>
        </div>
      </Link>

      {/* Read-only view for members without manage permission. */}
      {!canManage ? (
        member.role ? (
          <Badge variant="secondary" className="gap-1">
            <Tag className="size-3" />
            {member.role}
          </Badge>
        ) : null
      ) : (
        <>
          {/* Leader / head toggle */}
          <Button
            variant="ghost"
            size="icon"
            className={
              "size-8 " +
              (member.isLeader ? "text-primary" : "text-muted-foreground")
            }
            onClick={toggleLeader}
            disabled={leaderPending}
            aria-label={member.isLeader ? "Remove as leader" : "Make leader"}
            title={member.isLeader ? "Remove as leader" : "Make leader / head"}
          >
            {leaderPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : member.isLeader ? (
              <ShieldCheck className="size-4" />
            ) : (
              <Shield className="size-4" />
            )}
          </Button>

          {editing ? (
        <div className="flex items-center gap-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Role"
            className="h-8 w-28"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") saveRole();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={saveRole}
            disabled={pending}
            aria-label="Save role"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
          </Button>
        </div>
      ) : (
        <button
          onClick={() => {
            setDraft(member.role ?? "");
            setEditing(true);
          }}
          className="shrink-0"
          aria-label="Set role"
        >
          {member.role ? (
            <Badge variant="secondary" className="gap-1">
              <Tag className="size-3" />
              {member.role}
            </Badge>
          ) : (
            <span className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs">
              <Tag className="size-3" />
              Add role
            </span>
          )}
        </button>
      )}

      {confirm ? (
        <Button
          variant="destructive"
          size="icon"
          className="size-8"
          onClick={onRemove}
          disabled={busy}
          aria-label="Confirm remove"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setConfirm(true)}
          onBlur={() => setConfirm(false)}
          aria-label="Remove from group"
        >
          <Trash2 className="size-4" />
        </Button>
      )}
        </>
      )}
    </div>
  );
}

function AddMembersDialog({
  open,
  onOpenChange,
  groupId,
  candidates,
  existingIds,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  groupId: string;
  candidates: Candidate[];
  existingIds: Set<string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset selection when the dialog (re)opens.
  const [seen, setSeen] = useState(false);
  if (open && !seen) {
    setSelected(new Set());
    setQuery("");
    setSeen(true);
  }
  if (!open && seen) setSeen(false);

  const available = useMemo(
    () => candidates.filter((c) => !existingIds.has(c.id)),
    [candidates, existingIds],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter((c) => c.name.toLowerCase().includes(q));
  }, [available, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function add() {
    if (selected.size === 0) return;
    startTransition(async () => {
      const res = await addMembersToGroup(groupId, [...selected]);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Added ${selected.size} member${selected.size === 1 ? "" : "s"}`,
      );
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add members</DialogTitle>
        </DialogHeader>

        {available.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Everyone in your congregation is already in this group.
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search members"
                className="pl-9"
              />
            </div>
            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              {filtered.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  No members match.
                </p>
              ) : (
                <div className="space-y-1">
                  {filtered.map((c) => {
                    const on = selected.has(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => toggle(c.id)}
                        className={
                          "flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors " +
                          (on
                            ? "border-primary bg-primary/5"
                            : "hover:bg-accent")
                        }
                      >
                        <span
                          className={
                            "grid size-5 shrink-0 place-items-center rounded border " +
                            (on
                              ? "bg-primary border-primary text-primary-foreground"
                              : "border-input")
                          }
                        >
                          {on && <Check className="size-3.5" />}
                        </span>
                        <Avatar className="size-8">
                          <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                            {initials(c.name) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate text-sm font-medium">
                          {c.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <span className="text-muted-foreground text-sm">
            {selected.size > 0 && (
              <span className="inline-flex items-center gap-1">
                {selected.size} selected
                <button
                  onClick={() => setSelected(new Set())}
                  className="hover:text-foreground"
                  aria-label="Clear selection"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            )}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button onClick={add} disabled={pending || selected.size === 0}>
              {pending && <Loader2 className="animate-spin" />}
              Add{selected.size > 0 ? ` ${selected.size}` : ""}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
