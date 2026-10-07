"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { addFirstTimer } from "@/app/(app)/first-timers/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  FirstTimerFields,
  emptyFirstTimer,
  toIntake,
  type FirstTimerFormState,
  type MemberOption,
} from "@/components/first-timers/first-timer-fields";
import { useOpenOnShortcut } from "@/lib/use-opened-from-shortcut";
import { teach } from "@/lib/shortcut-teach";

/**
 * "Register a first-timer", wherever it is needed.
 *
 * The same button sits on the First-timers page and inside Follow-up, because
 * those are the two moments somebody actually has a new face in front of them.
 * Neither route goes anywhere near the membership form.
 */
export function RegisterFirstTimer({
  members,
  variant = "default",
  label = "Register a first-timer",
}: {
  members: MemberOption[];
  variant?: "default" | "outline";
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FirstTimerFormState>(emptyFirstTimer());

  /*
   * `n v` from anywhere, and the palette's "Register a first-timer".
   *
   * This component renders in two places — the First-timers page and inside
   * Follow-up — and the shortcut sends you to /first-timers, so only the one
   * on that page ever sees the parameter. The other reads nothing and does
   * nothing, which is why this can live in the shared component rather than
   * being threaded down as a prop from two different pages.
   */
  useOpenOnShortcut(() => {
    setForm(emptyFirstTimer());
    setOpen(true);
  });

  /*
   * Opening it with the button is the moment to mention `n v`. Reported only
   * when the dialog OPENS — reporting on close would teach a key to somebody
   * who has just cancelled.
   */
  function onOpenChange(next: boolean) {
    if (next) teach("new-first-timer");
    setOpen(next);
  }

  function set(patch: Partial<FirstTimerFormState>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function save(andAnother: boolean) {
    startTransition(async () => {
      const res = await addFirstTimer(toIntake(form));
      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      /*
       * "matched" is reported as plainly as "created".
       *
       * A welcome desk writes the same visitor down three Sundays running, and
       * silently doing nothing the second time looks like the form is broken.
       * Saying "they were already here, so they went into follow-up instead"
       * is the difference between trusting the page and tapping Save again.
       */
      if (res.outcome === "matched") toast.info(res.message);
      else toast.success(res.message);

      // Sunday morning is a queue of people, not one person. Keeping the form
      // open and cleared is the difference between this being usable at a
      // welcome desk and not.
      setForm(emptyFirstTimer());
      if (!andAnother) setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant={variant} size="sm">
          <UserPlus className="size-4" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register a first-time worshipper</DialogTitle>
          <DialogDescription>
            They go onto your register as a visitor and into follow-up, in one
            step. You will find them in Members too, exactly as before.
          </DialogDescription>
        </DialogHeader>

        <FirstTimerFields form={form} set={set} members={members} />

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => save(true)}
            disabled={pending || form.firstName.trim().length < 1}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save and add another
          </Button>
          <Button
            onClick={() => save(false)}
            disabled={pending || form.firstName.trim().length < 1}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
