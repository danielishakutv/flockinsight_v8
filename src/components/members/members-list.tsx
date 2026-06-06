"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Search, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { saveMember, deleteMember } from "@/app/(app)/members/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
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

const NONE = "none";

function fullName(m: MemberRow) {
  return [m.firstName, m.lastName].filter(Boolean).join(" ");
}
function initials(m: MemberRow) {
  return [m.firstName?.[0], m.lastName?.[0]].filter(Boolean).join("").toUpperCase();
}

type FormState = {
  id?: string;
  firstName: string;
  lastName: string;
  gender: string;
  phone: string;
  email: string;
  status: MemberRow["status"];
  dateOfBirth: string;
  notes: string;
};

const empty: FormState = {
  firstName: "",
  lastName: "",
  gender: NONE,
  phone: "",
  email: "",
  status: "active",
  dateOfBirth: "",
  notes: "",
};

export function MembersList({ members }: { members: MemberRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) =>
      [fullName(m), m.phone, m.email]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [members, query]);

  function openAdd() {
    setForm(empty);
    setOpen(true);
  }
  function openEdit(m: MemberRow) {
    setForm({
      id: m.id,
      firstName: m.firstName,
      lastName: m.lastName ?? "",
      gender: m.gender ?? NONE,
      phone: m.phone ?? "",
      email: m.email ?? "",
      status: m.status,
      dateOfBirth: m.dateOfBirth ?? "",
      notes: m.notes ?? "",
    });
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const res = await saveMember({
        id: form.id,
        firstName: form.firstName,
        lastName: form.lastName,
        gender: form.gender === NONE ? null : (form.gender as "male" | "female"),
        phone: form.phone,
        email: form.email,
        status: form.status,
        dateOfBirth: form.dateOfBirth,
        notes: form.notes,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(form.id ? "Member updated" : "Member added");
      setOpen(false);
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
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, phone or email"
            className="pl-9"
          />
        </div>
        <Button onClick={openAdd} size="lg">
          <Plus className="size-5" />
          Add member
        </Button>
      </div>

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="bg-primary/10 text-primary grid size-14 place-items-center rounded-2xl">
              <UserRound className="size-7" />
            </div>
            <p className="text-muted-foreground">
              {query ? "No members match your search." : "No members yet."}
            </p>
            {!query && (
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
              className="bg-card flex items-center gap-3 rounded-2xl border p-3 shadow-sm"
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
              <Badge variant={STATUS_VARIANT[m.status]}>
                {STATUS_LABEL[m.status]}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit"
                onClick={() => openEdit(m)}
              >
                <Pencil className="size-4" />
              </Button>
              {confirmId === m.id ? (
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
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add / edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit member" : "Add member"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="fn">First name</Label>
                <Input
                  id="fn"
                  value={form.firstName}
                  onChange={(e) =>
                    setForm({ ...form, firstName: e.target.value })
                  }
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ln">Last name</Label>
                <Input
                  id="ln"
                  value={form.lastName}
                  onChange={(e) =>
                    setForm({ ...form, lastName: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="gender">Gender</Label>
                <Select
                  value={form.gender}
                  onValueChange={(v) => setForm({ ...form, gender: v })}
                >
                  <SelectTrigger id="gender" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>—</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) =>
                    setForm({ ...form, status: v as MemberRow["status"] })
                  }
                >
                  <SelectTrigger id="status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="visitor">Visitor</SelectItem>
                    <SelectItem value="new_convert">New convert</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dob">Date of birth</Label>
                <Input
                  id="dob"
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) =>
                    setForm({ ...form, dateOfBirth: e.target.value })
                  }
                  className="h-11"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
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
            <Button
              onClick={save}
              disabled={pending || !form.firstName.trim()}
            >
              {pending && <Loader2 className="animate-spin" />}
              {form.id ? "Save" : "Add member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
