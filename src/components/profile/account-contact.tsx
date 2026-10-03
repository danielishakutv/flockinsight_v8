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
import { PasswordInput } from "@/components/ui/password-input";
import { useT } from "@/components/i18n-provider";

type Channel = "email" | "phone";

/** Where one row is in its change-and-confirm flow. */
type Step =
  | { kind: "idle" }
  /** `password` is only collected for the email row — see sendCode(). */
  | { kind: "editing"; value: string; password: string }
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

  function sendCode(channel: Channel, value: string, password: string) {
    setBusy(channel);
    start(async () => {
      /*
       * The password goes with the EMAIL only. It is a credential, so moving
       * it has to prove two separate things — that the asker owns the account
       * (the password) and that they can read mail at the new address (the
       * code). A phone number is neither a login nor a reset path, so a code
       * to it is the whole proof needed.
       */
      const res =
        channel === "email"
          ? await sendEmailChangeCode(value, password)
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
          needsPassword
          onBegin={() =>
            setStep("email", { kind: "editing", value: "", password: "" })
          }
          onCancel={() => setStep("email", { kind: "idle" })}
          onChangeValue={(v) => {
            const cur = steps.email;
            setStep("email", {
              kind: "editing",
              value: v,
              password: cur.kind === "editing" ? cur.password : "",
            });
          }}
          onChangePassword={(pw) => {
            const cur = steps.email;
            if (cur.kind === "editing")
              setStep("email", { ...cur, password: pw });
          }}
          onChangeCode={(code) => {
            const s = steps.email;
            if (s.kind === "code") setStep("email", { ...s, code });
          }}
          onSend={(v, pw) => sendCode("email", v, pw)}
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
          onBegin={() =>
            setStep("phone", {
              kind: "editing",
              value: phone ?? "",
              password: "",
            })
          }
          onCancel={() => setStep("phone", { kind: "idle" })}
          onChangeValue={(v) =>
            setStep("phone", { kind: "editing", value: v, password: "" })
          }
          onChangeCode={(code) => {
            const s = steps.phone;
            if (s.kind === "code") setStep("phone", { ...s, code });
          }}
          onSend={(v, pw) => sendCode("phone", v, pw)}
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
  needsPassword = false,
  step,
  busy,
  onBegin,
  onCancel,
  onChangeValue,
  onChangePassword,
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
  /** Ask for the current password before sending the code (email only). */
  needsPassword?: boolean;
  step: Step;
  busy: boolean;
  onBegin: () => void;
  onCancel: () => void;
  onChangeValue: (v: string) => void;
  onChangePassword?: (v: string) => void;
  onChangeCode: (v: string) => void;
  onSend: (v: string, password: string) => void;
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
            onSend(step.value, step.password);
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
          {needsPassword && (
            <div className="space-y-2 pt-1">
              <Label htmlFor={`${idBase}-pw`}>
                {t("profile.confirmWithPassword")}
              </Label>
              <PasswordInput
                id={`${idBase}-pw`}
                value={step.password}
                onChange={(e) => onChangePassword?.(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            {channel === "email"
              ? t("profile.newEmailHint")
              : t("profile.newPhoneHint")}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="submit"
              disabled={
                busy ||
                !step.value.trim() ||
                (needsPassword && !step.password)
              }
            >
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
