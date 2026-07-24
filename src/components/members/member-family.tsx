"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Baby, ChevronRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { saveMember } from "@/app/(app)/members/actions";
import { formatBirthday } from "@/lib/birthday";
import {
  MemberFormFields,
  emptyMember,
  memberFormToInput,
  type HouseholdOption,
  type MemberFormState,
} from "@/components/members/member-form-fields";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const REL_LABEL: Record<string, string> = {
  son: "Son",
  daughter: "Daughter",
  ward: "Ward",
  dependent: "Dependent",
};

type Child = {
  id: string;
  name: string;
  relationship: string | null;
  dateOfBirth: string | null;
  status: string;
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

/**
 * The family card on a member's profile: their children (with an "Add child"
 * button that registers a minor linked to this member as guardian). Only shown
 * to managers, and never on a child's own profile — a child isn't a guardian.
 */
export function MemberFamily({
  parentId,
  parentName,
  isMinor,
  guardianId,
  guardianName,
  kids,
  canManage,
  householdId = null,
  households = [],
}: {
  parentId: string;
  parentName: string;
  isMinor: boolean;
  guardianId: string | null;
  guardianName: string | null;
  kids: Child[];
  canManage: boolean;
  /** The parent's household — a new child inherits it by default. */
  householdId?: string | null;
  households?: HouseholdOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [form, setForm] = useState<MemberFormState>(emptyMember);

  // A child's own profile shows who their guardian is, not an "add child" card.
  if (isMinor) {
    if (!guardianId) return null;
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Baby className="text-primary size-5" /> Family
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Link
            href={`/members/${guardianId}`}
            className="hover:border-primary/50 flex items-center gap-3 rounded-xl border p-3 transition-colors"
          >
            <Avatar className="size-10">
              <AvatarFallback className="bg-primary/15 text-primary font-bold">
                {initials(guardianName ?? "?")}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">
                {guardianName ?? "Guardian"}
              </p>
              <p className="text-muted-foreground text-xs">Parent / guardian</p>
            </div>
            <ChevronRight className="text-muted-foreground size-5" />
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Nothing to show a non-manager when there are no children.
  if (!canManage && kids.length === 0) return null;

  function openAdd() {
    setForm({
      ...emptyMember(),
      isMinor: true,
      guardianId: parentId,
      // Inherit the parent's household by default (still editable).
      householdId: householdId ?? "",
    });
    setOpen(true);
  }

  function save() {
    start(async () => {
      const res = await saveMember(memberFormToInput(form));
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Child added");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Baby className="text-primary size-5" /> Children
        </CardTitle>
        {canManage && (
          <Button variant="outline" size="sm" onClick={openAdd}>
            <Plus className="size-4" /> Add child
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {kids.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No children registered under {parentName} yet.
          </p>
        ) : (
          <div className="space-y-2">
            {kids.map((c) => {
              const bday = formatBirthday(c.dateOfBirth);
              const rel = c.relationship
                ? REL_LABEL[c.relationship] ?? c.relationship
                : null;
              return (
                <Link
                  key={c.id}
                  href={`/members/${c.id}`}
                  className="hover:border-primary/50 flex items-center gap-3 rounded-xl border p-3 transition-colors"
                >
                  <Avatar className="size-10">
                    <AvatarFallback className="bg-primary/15 text-primary font-bold">
                      {initials(c.name) || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{c.name}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {[rel, bday].filter(Boolean).join(" · ") || "Child"}
                    </p>
                  </div>
                  <ChevronRight className="text-muted-foreground size-5" />
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Add-child dialog — guardian is locked to this member. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>Add child of {parentName}</DialogTitle>
          </DialogHeader>
          <MemberFormFields
            form={form}
            set={(patch) => setForm((f) => ({ ...f, ...patch }))}
            guardians={[{ id: parentId, name: parentName }]}
            lockGuardian
            households={households}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !form.firstName.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              Add child
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
