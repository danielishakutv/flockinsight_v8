"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saveMember, deleteMember } from "@/app/(app)/members/actions";
import {
  MemberFormFields,
  memberToForm,
  memberFormToInput,
  type Guardian,
  type HouseholdOption,
  type MemberFormState,
} from "@/components/members/member-form-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type MemberRecord = Parameters<typeof memberToForm>[0];

export function MemberEditForm({
  member,
  onDone,
  guardians = [],
  households = [],
}: {
  member: MemberRecord;
  onDone?: () => void;
  guardians?: Guardian[];
  households?: HouseholdOption[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<MemberFormState>(() => memberToForm(member));
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [confirm, setConfirm] = useState(false);

  function save() {
    startSave(async () => {
      const res = await saveMember(memberFormToInput(form));
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Member saved");
      router.refresh();
      onDone?.();
    });
  }

  function remove() {
    startDelete(async () => {
      const res = await deleteMember(member.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Member removed");
      router.push("/members");
    });
  }

  return (
    <Card>
      <CardContent className="space-y-6 py-6">
        <MemberFormFields
          form={form}
          set={(patch) => setForm((f) => ({ ...f, ...patch }))}
          guardians={guardians}
          households={households}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          {confirm ? (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">
                Delete this member?
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={remove}
                disabled={deleting}
              >
                {deleting && <Loader2 className="animate-spin" />}
                Confirm
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirm(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setConfirm(true)}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          )}

          <div className="flex items-center gap-2">
            {onDone && (
              <Button variant="outline" onClick={onDone} disabled={saving}>
                Cancel
              </Button>
            )}
            <Button onClick={save} disabled={saving || !form.firstName.trim()}>
              {saving && <Loader2 className="animate-spin" />}
              Save changes
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
