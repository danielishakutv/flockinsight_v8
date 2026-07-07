"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { saveMember, deleteMember, deleteMembers } from "@/app/(app)/members/actions";
import { track } from "@/lib/track";
import {
  MemberFormFields,
  emptyMember,
  memberFormToInput,
  type MemberFormState,
} from "@/components/members/member-form-fields";
import { MembersDataMenu } from "@/components/members/members-data-menu";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
        "grid size-5 place-items-center rounded border transition-colors",
        on ? "bg-primary border-primary text-primary-foreground" : "border-input",
      )}
    >
      {on && <Check className="size-3.5" />}
    </span>
  );
}

export function MembersList({
  members,
  canManage = true,
  signupUrl,
  signupEnabled = false,
}: {
  members: MemberRow[];
  canManage?: boolean;
  signupUrl?: string;
  signupEnabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<MemberFormState>(emptyMember);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) =>
      [fullName(m), m.phone, m.email]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [members, query]);

  const allSelected =
    filtered.length > 0 && filtered.every((m) => selected.has(m.id));

  function toggleSel(id: string) {
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    setConfirmBulk(false);
  }
  function toggleAll() {
    setSelected((p) =>
      allSelected ? new Set() : new Set(filtered.map((m) => m.id)),
    );
    setConfirmBulk(false);
  }
  function clearSel() {
    setSelected(new Set());
    setConfirmBulk(false);
  }

  function bulkDelete() {
    startTransition(async () => {
      const res = await deleteMembers([...selected]);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${res.deleted} member${res.deleted === 1 ? "" : "s"} removed`);
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
          {canManage && (
            <Button onClick={openAdd} size="lg" className="flex-1 sm:flex-none">
              <Plus className="size-5" />
              Add member
            </Button>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {canManage && selected.size > 0 && (
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
            {confirmBulk ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={bulkDelete}
                disabled={pending}
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Delete {selected.size}?
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmBulk(true)}
                className="text-destructive"
              >
                <Trash2 className="size-4" /> Delete
              </Button>
            )}
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
              {canManage && (
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
                  <p className="truncate font-bold">{fullName(m)}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {m.phone || m.email || "No contact"}
                  </p>
                </div>
              </Link>
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
    </div>
  );
}
