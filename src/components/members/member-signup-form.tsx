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
import { useT } from "@/components/i18n-provider";

export type SignupConfig = {
  slug: string;
  successMessage: string;
  collectBirthday: boolean;
  collectAddress: boolean;
  collectAnniversary: boolean;
  collectChildren: boolean;
  allowGroupSelect: boolean;
};

export type SignupGroup = { id: string; name: string; type: string };

type Child = { firstName: string; gender: "male" | "female" | ""; dateOfBirth: string };

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
  children: Child[];
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
  children: [],
};

export function MemberSignupForm({
  config,
  groups,
}: {
  config: SignupConfig;
  groups: SignupGroup[];
}) {
  const t = useT();
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
  function addChild() {
    setValues((p) =>
      p.children.length >= 15
        ? p
        : { ...p, children: [...p.children, { firstName: "", gender: "", dateOfBirth: "" }] },
    );
  }
  function setChild(i: number, patch: Partial<Child>) {
    setValues((p) => {
      const children = [...p.children];
      children[i] = { ...children[i], ...patch };
      return { ...p, children };
    });
  }
  function removeChild(i: number) {
    setValues((p) => ({ ...p, children: p.children.filter((_, j) => j !== i) }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!values.firstName.trim()) {
      toast.error(t("members.pleaseEnterYourFirstName"));
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
      toast.success(t("members.aNewCodeIsOn"));
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
            <h2 className="text-lg font-bold">{t("members.confirmItAposSYou")}</h2>
            <p className="text-muted-foreground text-sm">
              You already have a record with us. We sent a 6-digit code to{" "}
              <b>{otp.masked}</b> ({otp.channel}). Enter it to update your details.
            </p>
          </div>
        </div>
        <div>
          <Label htmlFor="otp-code">{t("members.verificationCode")}</Label>
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

      <Section title={t("members.yourDetails")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("members.firstName")} required>
            <Input value={values.firstName} onChange={(e) => set("firstName", e.target.value)} />
          </Field>
          <Field label={t("members.lastName")}>
            <Input value={values.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </Field>
          <Field label={t("members.gender")}>
            <Select
              value={values.gender || undefined}
              onValueChange={(v) => set("gender", v as Values["gender"])}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("members.select")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">{t("members.male")}</SelectItem>
                <SelectItem value="female">{t("members.female")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {config.collectBirthday && (
            <Field label={t("members.dateOfBirth")} hint={t("members.yearIsOptional")}>
              <BirthdayInput
                value={values.dateOfBirth}
                onChange={(v) => set("dateOfBirth", v)}
              />
            </Field>
          )}
        </div>
      </Section>

      <Section title={t("members.howWeReachYou")} hint={t("members.enterAtLeastAnEmail")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("members.phone")}>
            <Input
              type="tel"
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>
          <Field label={t("members.email")}>
            <Input
              type="email"
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
        </div>
      </Section>

      {config.collectChildren && (
        <Section
          title={t("members.yourChildren")}
          hint={t("members.optionalAddYourChildrenSo")}
        >
          <div className="space-y-3">
            {values.children.map((c, i) => (
              <div key={i} className="rounded-xl border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold">Child {i + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeChild(i)}
                    className="text-muted-foreground hover:text-destructive text-sm"
                  >
                    Remove
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t("members.firstName")}>
                      <Input
                        value={c.firstName}
                        onChange={(e) => setChild(i, { firstName: e.target.value })}
                      />
                    </Field>
                    <Field label={t("members.gender")}>
                      <Select
                        value={c.gender || undefined}
                        onValueChange={(v) => setChild(i, { gender: v as Child["gender"] })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("members.select")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="male">{t("members.male")}</SelectItem>
                          <SelectItem value="female">{t("members.female")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <Field label={t("members.dateOfBirth")} hint={t("members.yearOptional")}>
                    <BirthdayInput
                      value={c.dateOfBirth}
                      onChange={(v) => setChild(i, { dateOfBirth: v })}
                    />
                  </Field>
                </div>
              </div>
            ))}
            {values.children.length < 15 && (
              <Button type="button" variant="outline" onClick={addChild}>
                + Add a child
              </Button>
            )}
          </div>
        </Section>
      )}

      {config.collectAnniversary && (
        <Section title={t("members.milestones")} hint={t("members.optionalSoWeCanCelebrate")}>
          <Field label={t("members.weddingAnniversary")}>
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
        <Section title={t("members.whereYouLive")} hint={t("members.optional")}>
          <div className="grid gap-4">
            <Field label={t("members.address")}>
              <Input value={values.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("members.cityTown")}>
                <Input value={values.city} onChange={(e) => set("city", e.target.value)} />
              </Field>
              <Field label={t("members.state")}>
                <Input value={values.state} onChange={(e) => set("state", e.target.value)} />
              </Field>
            </div>
          </div>
        </Section>
      )}

      {config.allowGroupSelect && groups.length > 0 && (
        <Section
          title={t("members.ministriesGroups")}
          hint={t("members.tickAnyYouBelongTo")}
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
