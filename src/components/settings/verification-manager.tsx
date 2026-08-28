"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  IdCard,
  Loader2,
  Mail,
  Phone,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  confirmCode,
  sendEmailCode,
  sendPhoneCode,
} from "@/app/(app)/settings/verification/actions";
import {
  VERIFICATION_LABEL,
  verificationState,
} from "@/lib/verification-shared";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Channel = "email" | "phone";

/** Where one of the two rows is in its verify-or-change flow. */
type Step =
  | { kind: "idle" }
  | { kind: "editing"; value: string }
  | { kind: "code"; otpId: string; masked: string; code: string };

export function VerificationManager({
  contactEmail,
  contactPhone,
  emailVerifiedAt,
  phoneVerifiedAt,
}: {
  contactEmail: string | null;
  contactPhone: string | null;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<Channel | null>(null);
  const [steps, setSteps] = useState<Record<Channel, Step>>({
    email: { kind: "idle" },
    phone: { kind: "idle" },
  });

  const fields = { contactEmail, contactPhone, emailVerifiedAt, phoneVerifiedAt };
  const state = verificationState(fields);
  const emailOk = !!contactEmail && !!emailVerifiedAt;
  const phoneOk = !!contactPhone && !!phoneVerifiedAt;

  function setStep(channel: Channel, step: Step) {
    setSteps((s) => ({ ...s, [channel]: step }));
  }

  function beginEdit(channel: Channel) {
    setStep(channel, {
      kind: "editing",
      value: (channel === "email" ? contactEmail : contactPhone) ?? "",
    });
  }

  function sendCode(channel: Channel, value: string) {
    setBusy(channel);
    startTransition(async () => {
      const res =
        channel === "email"
          ? await sendEmailCode(value)
          : await sendPhoneCode(value);
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        channel === "email"
          ? `Code sent to ${res.masked}. Check your inbox (and spam).`
          : `Code sent by SMS to ${res.masked}.`,
      );
      setStep(channel, {
        kind: "code",
        otpId: res.otpId,
        masked: res.masked,
        code: "",
      });
    });
  }

  function confirm(channel: Channel, otpId: string, code: string) {
    setBusy(channel);
    startTransition(async () => {
      const res = await confirmCode(otpId, code);
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        channel === "email"
          ? "Email address verified ✅"
          : "Phone number verified ✅",
      );
      setStep(channel, { kind: "idle" });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* Overall standing — the first thing to read on the page. */}
      <Card
        className={cn(
          state === "verified"
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-amber-500/40 bg-amber-500/5",
        )}
      >
        <CardContent className="flex flex-wrap items-center gap-3">
          <div
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl",
              state === "verified"
                ? "bg-emerald-500/15 text-emerald-600"
                : "bg-amber-500/15 text-amber-600",
            )}
          >
            {state === "verified" ? (
              <ShieldCheck className="size-6" />
            ) : (
              <ShieldAlert className="size-6" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 font-bold">
              {VERIFICATION_LABEL[state]}
              {state === "verified" && (
                <BadgeCheck className="size-4 fill-sky-500 text-white" />
              )}
            </p>
            <p className="text-muted-foreground text-sm">
              {state === "verified"
                ? "Your church carries a verification tick on its public page and in the church directory."
                : "Verify both your email address and your phone number to earn your church's verification tick."}
            </p>
          </div>
          <div className="flex gap-1.5">
            <Badge variant={emailOk ? "success" : "warning"}>
              Email {emailOk ? "verified" : "pending"}
            </Badge>
            <Badge variant={phoneOk ? "success" : "warning"}>
              Phone {phoneOk ? "verified" : "pending"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Account contact details</CardTitle>
          <CardDescription>
            These are how FlockInsight reaches your church about its account —
            separate from what visitors see on your public page. Changing one
            sends a code to the new address or number, and it only takes effect
            once you enter that code.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <ChannelRow
            channel="email"
            icon={Mail}
            label="Account email address"
            hint="We'll send receipts, alerts and account notices here."
            placeholder="office@yourchurch.org"
            inputType="email"
            value={contactEmail}
            verified={emailOk}
            verifiedAt={emailVerifiedAt}
            step={steps.email}
            busy={busy === "email" && pending}
            onBegin={() => beginEdit("email")}
            onCancel={() => setStep("email", { kind: "idle" })}
            onChangeValue={(v) => setStep("email", { kind: "editing", value: v })}
            onChangeCode={(code) => {
              const s = steps.email;
              if (s.kind === "code") setStep("email", { ...s, code });
            }}
            onSend={(v) => sendCode("email", v)}
            onConfirm={(otpId, code) => confirm("email", otpId, code)}
          />
          <ChannelRow
            channel="phone"
            icon={Phone}
            label="Account phone number"
            hint="Used for urgent account messages. Nigerian numbers: 0803… or +234803…"
            placeholder="08012345678"
            inputType="tel"
            value={contactPhone}
            verified={phoneOk}
            verifiedAt={phoneVerifiedAt}
            step={steps.phone}
            busy={busy === "phone" && pending}
            onBegin={() => beginEdit("phone")}
            onCancel={() => setStep("phone", { kind: "idle" })}
            onChangeValue={(v) => setStep("phone", { kind: "editing", value: v })}
            onChangeCode={(code) => {
              const s = steps.phone;
              if (s.kind === "code") setStep("phone", { ...s, code });
            }}
            onSend={(v) => sendCode("phone", v)}
            onConfirm={(otpId, code) => confirm("phone", otpId, code)}
          />
        </CardContent>
      </Card>

      {/* Step two. Named honestly rather than hidden, so a church knows what's
          coming and doesn't wonder why "verified" isn't the end of it. */}
      <Card className="border-dashed">
        <CardContent className="flex flex-wrap items-center gap-3">
          <div className="bg-muted text-muted-foreground grid size-11 shrink-0 place-items-center rounded-xl">
            <IdCard className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold">
              Identity check (KYC){" "}
              <Badge variant="secondary" className="ml-1 align-middle">
                Coming soon
              </Badge>
            </p>
            <p className="text-muted-foreground text-sm">
              After verification, we&apos;ll ask for an ID document from a
              church leader to fully confirm your church. Nothing is needed from
              you yet — we&apos;ll get in touch when it opens.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ChannelRow({
  channel,
  icon: Icon,
  label,
  hint,
  placeholder,
  inputType,
  value,
  verified,
  verifiedAt,
  step,
  busy,
  onBegin,
  onCancel,
  onChangeValue,
  onChangeCode,
  onSend,
  onConfirm,
}: {
  channel: Channel;
  icon: typeof Mail;
  label: string;
  hint: string;
  placeholder: string;
  inputType: "email" | "tel";
  value: string | null;
  verified: boolean;
  verifiedAt: string | null;
  step: Step;
  busy: boolean;
  onBegin: () => void;
  onCancel: () => void;
  onChangeValue: (v: string) => void;
  onChangeCode: (v: string) => void;
  onSend: (v: string) => void;
  onConfirm: (otpId: string, code: string) => void;
}) {
  const idBase = `verify-${channel}`;

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start gap-3">
        <div
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl",
            verified
              ? "bg-emerald-500/15 text-emerald-600"
              : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-semibold">
            {label}
            {verified && <BadgeCheck className="size-4 fill-sky-500 text-white" />}
          </p>
          <p className="truncate text-sm">
            {value || (
              <span className="text-muted-foreground italic">Not set yet</span>
            )}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {verified && verifiedAt
              ? `Verified on ${new Date(verifiedAt).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}`
              : hint}
          </p>
        </div>
        {step.kind === "idle" && (
          <Button variant={verified ? "outline" : "default"} onClick={onBegin}>
            {verified ? "Change" : value ? "Verify" : "Add & verify"}
          </Button>
        )}
      </div>

      {step.kind === "editing" && (
        <form
          className="mt-3 space-y-2 rounded-xl border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSend(step.value);
          }}
        >
          <Label htmlFor={idBase}>
            {verified ? `New ${channel === "email" ? "email address" : "phone number"}` : label}
          </Label>
          <Input
            id={idBase}
            type={inputType}
            inputMode={channel === "phone" ? "tel" : "email"}
            autoComplete={channel === "phone" ? "tel" : "email"}
            value={step.value}
            placeholder={placeholder}
            onChange={(e) => onChangeValue(e.target.value)}
            autoFocus
            required
          />
          <p className="text-muted-foreground text-xs">
            We&apos;ll send a 6-digit code
            {channel === "email" ? " to this address" : " to this number by SMS"}.
            Nothing changes until you enter it.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" disabled={busy || !step.value.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              Send code
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {step.kind === "code" && (
        <form
          className="bg-muted/40 mt-3 space-y-2 rounded-xl border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(step.otpId, step.code);
          }}
        >
          <Label htmlFor={`${idBase}-code`}>
            Enter the code we sent to {step.masked}
          </Label>
          <Input
            id={`${idBase}-code`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={step.code}
            placeholder="000000"
            onChange={(e) => onChangeCode(e.target.value.replace(/\D/g, ""))}
            className="max-w-[12rem] text-center text-2xl font-bold tracking-[0.4em]"
            autoFocus
            required
          />
          <p className="text-muted-foreground text-xs">
            The code expires in 10 minutes.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" disabled={busy || step.code.length !== 6}>
              {busy && <Loader2 className="animate-spin" />}
              Confirm
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
              Start again
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
