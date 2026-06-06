"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteAttendance } from "@/app/(app)/attendance/actions";
import { Button } from "@/components/ui/button";

export function DeleteSessionButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function onDelete() {
    startTransition(async () => {
      const res = await deleteAttendance(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Attendance deleted");
      router.push("/attendance");
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="size-5" />
        Delete
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="lg"
        onClick={() => setConfirming(false)}
        disabled={pending}
      >
        Cancel
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="lg"
        onClick={onDelete}
        disabled={pending}
      >
        {pending ? <Loader2 className="animate-spin" /> : <Trash2 className="size-5" />}
        Confirm delete
      </Button>
    </div>
  );
}
