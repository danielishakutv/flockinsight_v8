"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  recordMyPayment,
  type SelfReportInput,
} from "@/app/p/[slug]/actions";
import { METHOD_LABEL } from "@/lib/contributions-shared";
import { currencySymbol } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, MoneyInput } from "@/components/contributions/pieces";
import { ProofField, type ProofValue } from "@/components/contributions/proof-field";
import { useT } from "@/components/i18n-provider";

const METHODS = ["transfer", "cash", "card", "cheque", "online", "other"] as const;

/**
 * "I have paid" — the form somebody fills in from a WhatsApp link.
 *
 * Written for a person who has never seen this software and will see it once.
 * Every label is a question in plain words, the field order is the order they
 * remember things in (who am I, how much, when), and only the name, amount and
 * date are required — demanding an email address from somebody doing the church
 * a favour is how a form goes unused.
 *
 * It is explicit that nothing counts until the team confirms it. Hiding that
 * would be worse than useless: they would see their entry on the page, assume it
 * was done, and be surprised when the total did not move.
 */
export function SelfReportForm({
  slug,
  currency,
  today,
  askForProof,
  canAskToHide,
  onDone,
}: {
  slug: string;
  currency: string;
  today: string;
  askForProof: boolean;
  /**
   * Whether "don't show my name" is worth offering.
   *
   * False when the page already hides every name, or shows no list at all.
   * A tickbox that changes nothing visible is a promise the page did not need
   * to make, and somebody would tick it and then wonder which one of the two
   * settings had been honoured.
   */
  canAskToHide: boolean;
  onDone?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState("transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [proof, setProof] = useState<ProofValue>(null);
  const [hp, setHp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | undefined>();
  const [done, setDone] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorField(undefined);
    const payload: SelfReportInput = {
      slug,
      name,
      phone,
      email,
      amount,
      paidOn,
      method,
      reference,
      note,
      /*
       * Only sent when the page could honour it. The server honours it only
       * for somebody new to the roster — see the comment in the action: the
       * names on this page are not secrets, so a tickbox must not be able to
       * reach into a row that already belongs to somebody else.
       */
      anonymous: canAskToHide ? anonymous : false,
      proofMediaId: proof?.mediaId ?? null,
      hp,
    };
    start(async () => {
      const res = await recordMyPayment(payload);
      if (!res.ok) {
        setError(res.error);
        setErrorField(res.field);
        return;
      }
      setDone(res.message);
      onDone?.();
      // Pull the new figures so they can see their own line appear, marked as
      // awaiting. Seeing it is the receipt.
      router.refresh();
    });
  }

  if (done) {
    return (
      <div className="bg-success/10 border-success/30 rounded-2xl border p-5 text-center">
        <CheckCircle2 className="text-success mx-auto size-10" aria-hidden />
        <p className="mt-3 font-bold">{done}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => {
            // A second person on a shared phone is a real case — a leader
            // passing their handset round after a meeting.
            setDone(null);
            setName("");
            setPhone("");
            setEmail("");
            setAmount("");
            setReference("");
            setNote("");
            setProof(null);
          }}
        >
          {t("contributions.recordAnother")}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bg-card rounded-2xl border p-4 sm:p-5">
      <h2 className="text-lg font-bold">{t("contributions.selfTitle")}</h2>
      <p className="text-muted-foreground mt-1 text-sm">{t("contributions.selfBlurb")}</p>

      <div className="mt-4 space-y-4">
        <Field
          label={t("contributions.selfYourName")}
          htmlFor="sr-name"
          error={errorField === "name" ? error : null}
        >
          <Input
            id="sr-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={160}
            required
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t("contributions.selfYourPhone")}
            htmlFor="sr-phone"
            hint={t("contributions.selfYourPhoneHint")}
            error={errorField === "phone" ? error : null}
          >
            <Input
              id="sr-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              maxLength={40}
            />
          </Field>
          <Field
            label={t("contributions.selfYourEmail")}
            htmlFor="sr-email"
            error={errorField === "email" ? error : null}
          >
            <Input
              id="sr-email"
              name="email"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              maxLength={200}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t("contributions.selfAmount")}
            htmlFor="sr-amount"
            error={errorField === "amount" ? error : null}
          >
            <MoneyInput
              id="sr-amount"
              name="amount"
              value={amount}
              onChange={setAmount}
              currencyPrefix={currencySymbol(currency)}
              required
            />
          </Field>
          <Field
            label={t("contributions.selfDate")}
            htmlFor="sr-date"
            error={errorField === "paidOn" ? error : null}
          >
            <Input
              id="sr-date"
              name="paidOn"
              type="date"
              value={paidOn}
              max={today}
              onChange={(e) => setPaidOn(e.target.value)}
              required
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("contributions.selfMethod")} htmlFor="sr-method">
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="sr-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {METHOD_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("contributions.selfReference")} htmlFor="sr-ref">
            <Input
              id="sr-ref"
              name="reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={120}
              autoComplete="off"
            />
          </Field>
        </div>

        <Field label={t("contributions.selfNote")} htmlFor="sr-note">
          <Textarea
            id="sr-note"
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={400}
          />
        </Field>

        {canAskToHide && (
          <label className="bg-muted/40 flex cursor-pointer items-start gap-3 rounded-xl border p-3">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
              className="accent-primary mt-0.5 size-4 shrink-0"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">
                {t("contributions.selfHideName")}
              </span>
              <span className="text-muted-foreground block text-xs leading-relaxed">
                {t("contributions.selfHideNameHint")}
              </span>
            </span>
          </label>
        )}

        {askForProof && (
          <Field label={t("contributions.selfProof")}>
            <ProofField
              value={proof}
              onChange={setProof}
              slug={slug}
              disabled={pending}
              labels={{
                attach: t("contributions.attachProof"),
                attached: t("contributions.proofAttached"),
                hint: t("contributions.proofHint"),
              }}
            />
          </Field>
        )}

        {/*
          The honeypot. Off screen for a person, irresistible to a script that
          fills every input it finds. `tabIndex={-1}` and `aria-hidden` keep it
          away from keyboards and screen readers, so it catches bots without
          inconveniencing anybody — unlike a CAPTCHA, which inconveniences
          everybody and would be a wall in front of a church collection.
        */}
        <input
          type="text"
          name="website"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          autoComplete="off"
        />

        {error && !errorField && (
          <p className="text-destructive text-sm font-medium" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden /> {t("contributions.selfSubmitting")}
            </>
          ) : (
            t("contributions.selfSubmit")
          )}
        </Button>
      </div>
    </form>
  );
}
