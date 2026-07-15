"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  submitSelfRegistration,
  verifySelfRegistration,
} from "@/app/join/[slug]/actions";
import { BirthdayInput } from "@/components/members/birthday-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type SignupConfig = {
  slug: string;
  successMessage: string;
  collectBirthday: boolean;
  collectAddress: boolean;
  collectAnniversary: boolean;
  allowGroupSelect: boolean;
};

export type SignupGroup = { id: string; name: string; type: string };

type Values = {
  firstName: string;
  lastName: string;
  gender: "male" | "female" | "";
  phone: string;
  email: string;
  dateOfBirth: string;
  weddingDate: string;
  address: string;
  city: string;
  state: string;
  groupIds: string[];
};

const empty: Values = {
  firstName: "",
  lastName: "",
  gender: "",
  phone: "",
  email: "",
  dateOfBirth: "",
  weddingDate: "",
  address: "",
  city: "",
  state: "",
  groupIds: [],
};

export function MemberSignupForm({
  config,
  groups,
}: {
  config: SignupConfig;
  groups: SignupGroup[];
}) {
  const [values, setValues] = useState<Values>(empty);
  const [hp, setHp] = useState("");
  const [step, setStep] = useState<"form" | "otp" | "done">("form");
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState<{ otpId: string; channel: string; masked: string } | null>(null);
  const [code, setCode] = useState("");
  const [doneMsg, setDoneMsg] = useState("");

  function set<K extends keyof Values>(k: K, v: Values[K]) {
    setValues((p) => ({ ...p, [k]: v }));
  }
  function toggleGroup(id: string) {
    setValues((p) => ({
      ...p,
      groupIds: p.groupIds.includes(id)
        ? p.groupIds.filter((x) => x !== id)
        : [...p.groupIds, id],
    }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!values.firstName.trim()) {
      toast.error("Please enter your first name.");
      return;
    }
    setBusy(true);
    const res = await submitSelfRegistration({ slug: config.slug, values, hp });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if ("needsOtp" in res) {
      setOtp({ otpId: res.otpId, channel: res.channel, masked: res.masked });
      setCode("");
      setStep("otp");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setDoneMsg(res.message);
    setStep("done");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!otp) return;
    setBusy(true);
    const res = await verifySelfRegistration({
      slug: config.slug,
      otpId: otp.otpId,
      code,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setDoneMsg(res.message);
    setStep("done");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function resend() {
    setBusy(true);
    const res = await submitSelfRegistration({ slug: config.slug, values, hp });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if ("needsOtp" in res) {
      setOtp({ otpId: res.otpId, channel: res.channel, masked: res.masked });
      setCode("");
      toast.success("A new code is on its way.");
    }
  }

  if (step === "done") {
    return (
      <div className="bg-card rounded-2xl border p-8 text-center">
        <CheckCircle2 className="text-success mx-auto mb-3 size-10" />
        <p className="text-lg font-semibold">{doneMsg || config.successMessage}</p>
      </div>
    );
  }

  if (step === "otp" && otp) {
    return (
      <form onSubmit={onVerify} className="bg-card space-y-4 rounded-2xl border p-6">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Confirm it&apos;s you</h2>
            <p className="text-muted-foreground text-sm">
              You already have a record with us. We sent a 6-digit code to{" "}
              <b>{otp.masked}</b> ({otp.channel}). Enter it to update your details.
            </p>
          </div>
        </div>
        <div>
          <Label htmlFor="otp-code">Verification code</Label>
          <Input
            id="otp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            className="mt-1 text-center text-2xl tracking-[0.4em]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Confirm & save
          </Button>
          <Button type="button" variant="ghost" onClick={resend} disabled={busy}>
            Resend code
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep("form")}
            disabled={busy}
          >
            Back
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Honeypot */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={hp}
        onChange={(e) => setHp(e.target.value)}
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
        aria-hidden="true"
      />

      <Section title="Your details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required>
            <Input value={values.firstName} onChange={(e) => set("firstName", e.target.value)} />
          </Field>
          <Field label="Last name">
            <Input value={values.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </Field>
          <Field label="Gender">
            <Select
              value={values.gender || undefined}
              onValueChange={(v) => set("gender", v as Values["gender"])}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {config.collectBirthday && (
            <Field label="Date of birth" hint="Year is optional.">
              <BirthdayInput
                value={values.dateOfBirth}
                onChange={(v) => set("dateOfBirth", v)}
              />
            </Field>
          )}
        </div>
      </Section>

      <Section title="How we reach you" hint="Enter at least an email or phone number.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone">
            <Input
              type="tel"
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
        </div>
      </Section>

      {config.collectAnniversary && (
        <Section title="Milestones" hint="Optional — so we can celebrate with you.">
          <Field label="Wedding anniversary">
            <Input
              type="date"
              className="h-11"
              value={values.weddingDate}
              onChange={(e) => set("weddingDate", e.target.value)}
            />
          </Field>
        </Section>
      )}

      {config.collectAddress && (
        <Section title="Where you live" hint="Optional.">
          <div className="grid gap-4">
            <Field label="Address">
              <Input value={values.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="City / town">
                <Input value={values.city} onChange={(e) => set("city", e.target.value)} />
              </Field>
              <Field label="State">
                <Input value={values.state} onChange={(e) => set("state", e.target.value)} />
              </Field>
            </div>
          </div>
        </Section>
      )}

      {config.allowGroupSelect && groups.length > 0 && (
        <Section
          title="Ministries & groups"
          hint="Tick any you belong to (or would like to join)."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {groups.map((g) => (
              <label
                key={g.id}
                className="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={values.groupIds.includes(g.id)}
                  onChange={() => toggleGroup(g.id)}
                  className="accent-primary size-4"
                />
                <span className="truncate">{g.name}</span>
              </label>
            ))}
          </div>
        </Section>
      )}

      <Button type="submit" size="lg" disabled={busy} className="w-full sm:w-auto">
        {busy && <Loader2 className="size-4 animate-spin" />}
        Submit
      </Button>
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-2xl border p-5">
      <h2 className="font-bold">{title}</h2>
      {hint && <p className="text-muted-foreground mb-3 text-sm">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-1 block">
        {label}
        {required && <span className="text-destructive"> *</span>}
        {hint && (
          <span className="text-muted-foreground ml-1 font-normal">
            ({hint})
          </span>
        )}
      </Label>
      {children}
    </div>
  );
}
