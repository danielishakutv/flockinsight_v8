"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Loader2, Mail, Phone } from "lucide-react";
import { toast } from "sonner";
import {
  confirmContactChange,
  sendEmailChangeCode,
  sendPhoneChangeCode,
} from "@/app/(app)/profile/actions";
import { cn } from "@/lib/utils";
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
import { useT } from "@/components/i18n-provider";

type Channel = "email" | "phone";

/** Where one row is in its change-and-confirm flow. */
type Step =
  | { kind: "idle" }
  | { kind: "editing"; value: string }
  | { kind: "code"; otpId: string; masked: string; code: string };

/**
 * Changing the email address or phone number on your own account.
 *
 * The code always goes to the NEW destination, and nothing is written until it
 * comes back — so an address can only ever be moved by somebody who can read
 * mail at the place it is moving to. The same shape as the church's
 * verification card, because it is the same promise.
 */
export function AccountContact({
  email,
  emailVerified,
  phone,
  phoneVerifiedAt,
  smsConfigured,
}: {
  email: string;
  emailVerified: boolean;
  phone: string | null;
  phoneVerifiedAt: string | null;
  smsConfigured: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<Channel | null>(null);
  const [steps, setSteps] = useState<Record<Channel, Step>>({
    email: { kind: "idle" },
    phone: { kind: "idle" },
  });

  const phoneOk = !!phone && !!phoneVerifiedAt;

  function setStep(channel: Channel, step: Step) {
    setSteps((s) => ({ ...s, [channel]: step }));
  }

  function sendCode(channel: Channel, value: string) {
    setBusy(channel);
    start(async () => {
      const res =
        channel === "email"
          ? await sendEmailChangeCode(value)
          : await sendPhoneChangeCode(value);
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        channel === "email"
          ? t("profile.codeSentEmail", { masked: res.masked })
          : t("profile.codeSentSms", { masked: res.masked }),
      );
      setStep(channel, { kind: "code", otpId: res.otpId, masked: res.masked, code: "" });
    });
  }

  function confirm(channel: Channel, otpId: string, code: string) {
    setBusy(channel);
    start(async () => {
      const res = await confirmContactChange(otpId, code);
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        channel === "email"
          ? t("profile.emailChanged")
          : t("profile.phoneVerified"),
      );
      setStep(channel, { kind: "idle" });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("profile.contactTitle")}</CardTitle>
        <CardDescription>{t("profile.contactHint")}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        <ContactRow
          channel="email"
          icon={Mail}
          label={t("profile.emailLabel")}
          hint={t("profile.emailHint")}
          placeholder="you@example.com"
          inputType="email"
          value={email}
          verified={emailVerified}
          verifiedLabel={t("profile.verified")}
          disabledReason={null}
          step={steps.email}
          busy={busy === "email" && pending}
          onBegin={() => setStep("email", { kind: "editing", value: "" })}
          onCancel={() => setStep("email", { kind: "idle" })}
          onChangeValue={(v) => setStep("email", { kind: "editing", value: v })}
          onChangeCode={(code) => {
            const s = steps.email;
            if (s.kind === "code") setStep("email", { ...s, code });
          }}
          onSend={(v) => sendCode("email", v)}
          onConfirm={(otpId, code) => confirm("email", otpId, code)}
        />
        <ContactRow
          channel="phone"
          icon={Phone}
          label={t("profile.phoneLabel")}
          hint={t("profile.phoneHint")}
          placeholder="08012345678"
          inputType="tel"
          value={phone}
          verified={phoneOk}
          verifiedLabel={
            phoneVerifiedAt
              ? t("profile.verifiedOn", {
                  date: new Date(phoneVerifiedAt).toLocaleDateString(t.intl, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  }),
                })
              : t("profile.verified")
          }
          disabledReason={smsConfigured ? null : t("profile.smsNotConfigured")}
          step={steps.phone}
          busy={busy === "phone" && pending}
          onBegin={() => setStep("phone", { kind: "editing", value: phone ?? "" })}
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
  );
}

function ContactRow({
  channel,
  icon: Icon,
  label,
  hint,
  placeholder,
  inputType,
  value,
  verified,
  verifiedLabel,
  disabledReason,
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
  verifiedLabel: string;
  /** Non-null disables the button and says why, rather than failing on press. */
  disabledReason: string | null;
  step: Step;
  busy: boolean;
  onBegin: () => void;
  onCancel: () => void;
  onChangeValue: (v: string) => void;
  onChangeCode: (v: string) => void;
  onSend: (v: string) => void;
  onConfirm: (otpId: string, code: string) => void;
}) {
  const t = useT();
  const idBase = `account-${channel}`;

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
              <span className="text-muted-foreground italic">
                {t("profile.notSetYet")}
              </span>
            )}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {verified ? verifiedLabel : hint}
          </p>
        </div>
        {step.kind === "idle" && (
          <Button
            variant={verified ? "outline" : "default"}
            onClick={onBegin}
            disabled={!!disabledReason}
          >
            {value ? t("profile.change") : t("profile.addAndVerify")}
          </Button>
        )}
      </div>

      {disabledReason && (
        <p className="text-muted-foreground mt-2 text-xs">{disabledReason}</p>
      )}

      {step.kind === "editing" && (
        <form
          className="mt-3 space-y-2 rounded-xl border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSend(step.value);
          }}
        >
          <Label htmlFor={idBase}>
            {channel === "email" ? t("profile.newEmail") : t("profile.newPhone")}
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
            {channel === "email"
              ? t("profile.newEmailHint")
              : t("profile.newPhoneHint")}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" disabled={busy || !step.value.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              {t("profile.sendCode")}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
              {t("profile.cancel")}
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
            {t("profile.enterCode", { masked: step.masked })}
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
            {t("profile.codeExpires")}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" disabled={busy || step.code.length !== 6}>
              {busy && <Loader2 className="animate-spin" />}
              {t("profile.confirm")}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
              {t("profile.startAgain")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
