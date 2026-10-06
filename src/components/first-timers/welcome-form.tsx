"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { submitWelcome } from "@/app/welcome/[slug]/actions";
import { Button } from "@/components/ui/button";
import {
  FirstTimerFields,
  emptyFirstTimer,
  toIntake,
  type FirstTimerFormState,
} from "@/components/first-timers/first-timer-fields";

/**
 * The form a first-time worshipper fills in themselves.
 *
 * Shares its fields with the one the welcome team uses, so the two can never
 * drift into asking different questions, but with three things off: no visit
 * date (it is today, by definition, and a date picker is one more thing to get
 * wrong on a phone), no notes (those are the church's words about a person,
 * not the person's own), and no inviter picker — a stranger must not be able
 * to name a member by id.
 */
export function WelcomeForm({
  slug,
  collectEmail,
  collectAddress,
  collectInvitedBy,
  successMessage,
}: {
  slug: string;
  collectEmail: boolean;
  collectAddress: boolean;
  collectInvitedBy: boolean;
  successMessage: string;
}) {
  const [form, setForm] = useState<FirstTimerFormState>(emptyFirstTimer());
  const [honeypot, setHoneypot] = useState("");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set(patch: Partial<FirstTimerFormState>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await submitWelcome(slug, toIntake(form), honeypot);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(res.message || successMessage);
    });
  }

  if (done) {
    return (
      <div className="rounded-2xl border px-6 py-12 text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
        <p className="mt-4 text-lg font-semibold">Thank you</p>
        <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
          {done}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <FirstTimerFields
        form={form}
        set={set}
        showEmail={collectEmail}
        showAddress={collectAddress}
        showInvitedBy={collectInvitedBy}
        showVisitDate={false}
        showNotes={false}
      />

      {/*
        The honeypot. Hidden from sight and from screen readers, never
        focusable, and not a `type="hidden"` input — a bot filling in every
        field is exactly what this catches, and a hidden input is the one it
        would skip. A filled one is answered with success and written nowhere.
      */}
      <div aria-hidden className="pointer-events-none absolute -left-[9999px] opacity-0">
        <label htmlFor="ft-company">Company</label>
        <input
          id="ft-company"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-4 py-3 text-sm"
        >
          {error}
        </p>
      )}

      <Button
        onClick={submit}
        disabled={pending || form.firstName.trim().length < 1}
        className="w-full"
        size="lg"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        Send my details
      </Button>

      <p className="text-muted-foreground text-center text-xs">
        Your details go only to this church, so they can say hello.
      </p>
    </div>
  );
}
