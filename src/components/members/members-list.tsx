"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Baby,
  Check,
  ChevronRight,
  Download,
  FileText,
  ListChecks,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  saveMember,
  deleteMember,
  deleteMembers,
  previewMemberDeletion,
  type DeleteImpact,
} from "@/app/(app)/members/actions";
import { inviteMembersAsStaff } from "@/app/(app)/members/access-actions";
import { track } from "@/lib/track";
import {
  MemberFormFields,
  emptyMember,
  memberFormToInput,
  type HouseholdOption,
  type MemberFormState,
} from "@/components/members/member-form-fields";
import { MembersDataMenu } from "@/components/members/members-data-menu";
import { TrainingBadges } from "@/components/training/training-badge";
import type { EarnedBadge } from "@/lib/training-shared";
import { MemberSignupLink } from "@/components/members/member-signup-link";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export type MemberRow = {
  id: string;
  firstName: string;
  lastName: string | null;
  gender: "male" | "female" | null;
  phone: string | null;
  email: string | null;
  status: "active" | "inactive" | "visitor" | "new_convert";
  dateOfBirth: string | null;
  notes: string | null;
  isMinor: boolean;
  guardianName: string | null;
};

const STATUS_LABEL: Record<MemberRow["status"], string> = {
  active: "Active",
  inactive: "Inactive",
  visitor: "Visitor",
  new_convert: "New convert",
};
const STATUS_VARIANT: Record<
  MemberRow["status"],
  "default" | "secondary" | "outline" | "success"
> = {
  active: "success",
  visitor: "secondary",
  new_convert: "default",
  inactive: "outline",
};

function fullName(m: MemberRow) {
  return [m.firstName, m.lastName].filter(Boolean).join(" ");
}
function initials(m: MemberRow) {
  return [m.firstName?.[0], m.lastName?.[0]]
    .filter(Boolean)
    .join("")
    .toUpperCase();
}

function SelectBox({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        // A 1px border the colour of the card reads as nothing at all on a
        // dark background, which is why nobody found bulk select. Thicker,
        // lighter, and larger than the 24px minimum for a tap target.
        "grid size-6 place-items-center rounded-md border-2 transition-colors",
        on
          ? "bg-primary border-primary text-primary-foreground"
          : "border-muted-foreground/50 hover:border-primary",
      )}
    >
      {on && <Check className="size-4" />}
    </span>
  );
}

/** One "1,284 attendance records" line, hidden when the count is zero. */
function ImpactRow({
  n,
  one,
  many,
}: {
  n: number;
  one: string;
  many: string;
}) {
  if (n === 0) return null;
  return (
    <li>
      <span className="text-foreground font-semibold">
        {n.toLocaleString()}
      </span>{" "}
      {n === 1 ? one : many}
    </li>
  );
}

export function MembersList({
  members,
  badges = {},
  canManage = true,
  signupUrl,
  signupEnabled = false,
  households = [],
  canManageTeam = false,
  accessRoles = [],
}: {
  members: MemberRow[];
  /** Completed training per member id, keyed for O(1) lookup while rendering. */
  badges?: Record<string, EarnedBadge[]>;
  canManage?: boolean;
  signupUrl?: string;
  signupEnabled?: boolean;
  households?: HouseholdOption[];
  /** Whether the viewer may grant app access (team.manage). */
  canManageTeam?: boolean;
  accessRoles?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [bulkAccessOpen, setBulkAccessOpen] = useState(false);
  const [bulkRoleId, setBulkRoleId] = useState("__none__");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<MemberFormState>(emptyMember);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [typed, setTyped] = useState("");
  const [downloading, setDownloading] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) =>
      [fullName(m), m.phone, m.email, m.guardianName]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [members, query]);

  // Only adults can be a guardian.
  const guardians = useMemo(
    () =>
      members
        .filter((m) => !m.isMinor)
        .map((m) => ({ id: m.id, name: fullName(m) })),
    [members],
  );

  const allSelected =
    filtered.length > 0 && filtered.every((m) => selected.has(m.id));

  function toggleSel(id: string) {
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    setConfirmBulk(false);
  }
  function toggleAll() {
    setSelected(() =>
      allSelected ? new Set() : new Set(filtered.map((m) => m.id)),
    );
    setConfirmBulk(false);
  }
  function clearSel() {
    setSelected(new Set());
    setConfirmBulk(false);
  }

  /*
   * Ask the server what this would destroy before asking the person.
   *
   * Deleting a member takes their attendance, follow-ups, group memberships
   * and training results with them. Real numbers make that a decision; "this
   * cannot be undone" is wallpaper.
   */
  function openBulkDelete() {
    if (selected.size === 0) return;
    setTyped("");
    setImpact(null);
    setConfirmBulk(true);
    setLoadingImpact(true);
    void (async () => {
      const res = await previewMemberDeletion([...selected]);
      setLoadingImpact(false);
      if (res.ok) setImpact(res.impact);
    })();
  }

  function bulkDelete() {
    startTransition(async () => {
      const res = await deleteMembers([...selected]);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${res.deleted} member${res.deleted === 1 ? "" : "s"} removed`);
      setConfirmBulk(false);
      setSelecting(false);
      clearSel();
      router.refresh();
    });
  }

  function bulkGiveAccess() {
    startTransition(async () => {
      const res = await inviteMembersAsStaff({
        memberIds: [...selected],
        roleId: bulkRoleId === "__none__" ? null : bulkRoleId,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.invited > 0) {
        toast.success(
          `${res.invited} invitation${res.invited === 1 ? "" : "s"} sent`,
        );
      }
      // Say exactly who was left out and why, rather than a silent partial run.
      if (res.skipped.length > 0) {
        toast.warning(
          `${res.skipped.length} skipped — ${res.skipped
            .slice(0, 3)
            .map((s) => `${s.name}: ${s.reason}`)
            .join("; ")}${res.skipped.length > 3 ? "…" : ""}`,
          { duration: 10000 },
        );
      }
      setBulkAccessOpen(false);
      setBulkRoleId("__none__");
      clearSel();
      router.refresh();
    });
  }

  async function bulkDownload(fmt: "csv" | "pdf") {
    setDownloading(true);
    try {
      const res = await fetch("/members/export/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], format: fmt }),
      });
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `members.${fmt}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not generate the download. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  function openAdd() {
    setForm(emptyMember());
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const res = await saveMember(memberFormToInput(form));
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Member added");
      track("member.added");
      setOpen(false);
      setForm(emptyMember());
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteMember(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Member removed");
      setConfirmId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, phone or email"
            className="pl-9"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canManage && signupUrl && (
            <MemberSignupLink url={signupUrl} enabled={signupEnabled} />
          )}
          <MembersDataMenu canManage={canManage} />
          {canManage && filtered.length > 0 && (
            /* The checkboxes were always there; nothing said so. */
            <Button
              variant={selecting ? "secondary" : "outline"}
              size="lg"
              onClick={() => {
                setSelecting((v) => !v);
                if (selecting) clearSel();
              }}
              aria-pressed={selecting}
            >
              <ListChecks className="size-5" />
              {selecting ? "Done" : "Select"}
            </Button>
          )}
          {canManage && (
            <Button onClick={openAdd} size="lg" className="flex-1 sm:flex-none">
              <Plus className="size-5" />
              Add member
            </Button>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {canManage && (selecting || selected.size > 0) && (
        <div className="bg-primary/5 border-primary/30 sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 shadow-sm backdrop-blur">
          <span className="text-sm font-semibold">
            {selected.size} selected
          </span>
          <button
            type="button"
            onClick={toggleAll}
            className="text-primary text-xs font-medium hover:underline"
          >
            {allSelected ? "Unselect all" : `Select all ${filtered.length}`}
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canManageTeam && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkAccessOpen(true)}
              >
                <ShieldCheck className="size-4" /> Give app access
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => bulkDownload("csv")}
              disabled={downloading}
            >
              <Download className="size-4" /> CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => bulkDownload("pdf")}
              disabled={downloading}
            >
              <FileText className="size-4" /> PDF
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={openBulkDelete}
              disabled={selected.size === 0}
              className="text-destructive"
            >
              <Trash2 className="size-4" /> Delete
            </Button>
            <Button variant="ghost" size="icon" aria-label="Clear selection" onClick={clearSel}>
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="bg-primary/10 text-primary grid size-14 place-items-center rounded-2xl">
              <UserRound className="size-7" />
            </div>
            <p className="text-muted-foreground">
              {query ? "No members match your search." : "No members yet."}
            </p>
            {!query && canManage && (
              <Button onClick={openAdd}>
                <Plus className="size-5" /> Add your first member
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => (
            <div
              key={m.id}
              className={cn(
                "bg-card hover:border-primary/40 flex items-center gap-3 rounded-2xl border p-3 shadow-sm transition-colors",
                selected.has(m.id) && "border-primary/50 bg-primary/5",
              )}
            >
              {canManage && (selecting || selected.size > 0) && (
                <button
                  type="button"
                  onClick={() => toggleSel(m.id)}
                  aria-label="Select member"
                  className="shrink-0"
                >
                  <SelectBox on={selected.has(m.id)} />
                </button>
              )}
              <Link
                href={`/members/${m.id}`}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <Avatar className="size-11">
                  <AvatarFallback className="bg-primary/15 text-primary font-bold">
                    {initials(m) || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-bold">
                    <span className="truncate">{fullName(m)}</span>
                    <TrainingBadges badges={badges[m.id] ?? []} max={2} />
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {m.isMinor
                      ? m.guardianName
                        ? `Child of ${m.guardianName}`
                        : "Child"
                      : m.phone || m.email || "No contact"}
                  </p>
                </div>
              </Link>
              {m.isMinor && (
                <Badge variant="secondary" className="gap-1">
                  <Baby className="size-3" /> Child
                </Badge>
              )}
              <Badge variant={STATUS_VARIANT[m.status]}>
                {STATUS_LABEL[m.status]}
              </Badge>
              {canManage &&
                (confirmId === m.id ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => remove(m.id)}
                    disabled={pending}
                  >
                    {pending ? <Loader2 className="animate-spin" /> : "Confirm"}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete"
                    onClick={() => setConfirmId(m.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ))}
              <Link
                href={`/members/${m.id}`}
                aria-label={`Open ${fullName(m)}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="size-5" />
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Quick add dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
          </DialogHeader>
          <MemberFormFields
            form={form}
            set={(patch) => setForm((f) => ({ ...f, ...patch }))}
            guardians={guardians}
            households={households}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !form.firstName.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              Add member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk delete: say what goes, and what stays. */}
      <Dialog open={confirmBulk} onOpenChange={(o) => !o && setConfirmBulk(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Delete {selected.size} member{selected.size === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              This cannot be undone. Download a copy first if you might need
              these records again.
            </DialogDescription>
          </DialogHeader>

          {loadingImpact ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" /> Checking what this
              affects…
            </p>
          ) : impact ? (
            <div className="space-y-3 text-sm">
              <div className="border-destructive/30 bg-destructive/5 rounded-xl border p-3">
                <p className="text-destructive font-semibold">
                  Deleted with them, permanently
                </p>
                <ul className="text-muted-foreground mt-1.5 space-y-1">
                  <ImpactRow
                    n={impact.attendance}
                    one="attendance record"
                    many="attendance records"
                  />
                  <ImpactRow
                    n={impact.followUps}
                    one="follow-up note"
                    many="follow-up notes"
                  />
                  <ImpactRow
                    n={impact.groupMemberships}
                    one="group membership"
                    many="group memberships"
                  />
                  <ImpactRow
                    n={impact.trainingEnrollments}
                    one="training result"
                    many="training results and certificates"
                  />
                  {impact.attendance +
                    impact.followUps +
                    impact.groupMemberships +
                    impact.trainingEnrollments ===
                    0 && <li>Nothing else — these members have no history yet.</li>}
                </ul>
              </div>

              {(impact.givingRecords > 0 || impact.pledges > 0) && (
                <div className="rounded-xl border p-3">
                  <p className="font-semibold">Kept, but no longer named</p>
                  <ul className="text-muted-foreground mt-1.5 space-y-1">
                    <ImpactRow
                      n={impact.givingRecords}
                      one="giving record"
                      many="giving records"
                    />
                    <ImpactRow n={impact.pledges} one="pledge" many="pledges" />
                  </ul>
                  <p className="text-muted-foreground mt-2 text-xs">
                    Your totals stay correct — these entries simply stop being
                    attached to a person.
                  </p>
                </div>
              )}
            </div>
          ) : null}

          {/* A big deletion should take more than two taps. */}
          {selected.size > 10 && (
            <div className="space-y-1.5">
              <Label htmlFor="confirm-delete">
                Type <span className="font-mono font-bold">DELETE</span> to
                confirm
              </Label>
              <Input
                id="confirm-delete"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
              />
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              onClick={() => bulkDownload("csv")}
              disabled={downloading}
            >
              <Download className="size-4" /> Download CSV first
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setConfirmBulk(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={bulkDelete}
                disabled={
                  pending ||
                  loadingImpact ||
                  (selected.size > 10 && typed.trim() !== "DELETE")
                }
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                Delete {selected.size}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk: give app access to everyone selected, with one role. */}
      <Dialog open={bulkAccessOpen} onOpenChange={setBulkAccessOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="bg-primary/10 text-primary mb-1 grid size-11 place-items-center rounded-full">
              <ShieldCheck className="size-5" />
            </div>
            <DialogTitle>
              Give app access to {selected.size} member
              {selected.size === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              Each one gets an email invitation to create a login. Anyone who
              already has access, or has no email on file, is skipped and
              reported back.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="bulk-role">Role for everyone selected</Label>
            <Select value={bulkRoleId} onValueChange={setBulkRoleId}>
              <SelectTrigger id="bulk-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No role yet</SelectItem>
                {accessRoles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkAccessOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button onClick={bulkGiveAccess} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Send {selected.size} invitation{selected.size === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
