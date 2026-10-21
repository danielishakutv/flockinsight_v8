"use client";

import { useState, useTransition } from "react";
import { CalendarCheck, CalendarPlus, Check, ChevronLeft, Copy, Loader2 } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  listOpenSlots,
  startMemberVerification,
  submitBooking,
  verifyMemberCode,
  type BookingSuccess,
} from "@/app/book/[slug]/actions";
import { buildIcs } from "@/lib/pastoral-ics";
import { locationKey } from "@/lib/pastoral-shared";
import { SlotPicker } from "@/components/pastoral/slot-picker";

type PublicType = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number | null;
  location: string;
  requiresApproval: boolean;
};
type PublicPastor = { id: string; displayName: string; title: string | null; typeIds: string[]; slotMinutes: number };

type Step = "verify" | "code" | "type" | "pastor" | "time" | "details" | "done";

/** Save a calendar file built here in the browser: no URL carrying the token serves it. */
export function downloadIcs(ics: NonNullable<BookingSuccess["ics"]>) {
  const body = buildIcs({ ...ics, method: "PUBLISH" });
  const href = URL.createObjectURL(new Blob([body], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = href;
  a.download = "appointment.ics";
  a.click();
  // Revoked a moment later: Safari and Firefox start the download after the
  // click returns, and an already-revoked URL saves nothing.
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/**
 * Booking time with a pastor, one question at a time, single column at phone
 * width with 44px targets.
 *
 * Members-only pages first prove the visitor is on the register with a
 * one-time code sent to the contact the church HAS, never one typed here.
 * The manage link is shown on the result, so a confirmation email that never
 * arrives does not strand anybody.
 */
export function PublicBookingFlow({
  slug,
  churchName,
  publicPhone,
  today,
  membersOnly,
  membersUnavailable,
  types,
  pastors,
}: {
  slug: string;
  churchName: string;
  publicPhone: string | null;
  /** The church zone; the slot list says it beside the times. */
  zone: string;
  today: string;
  membersOnly: boolean;
  membersUnavailable: boolean;
  types: PublicType[];
  pastors: PublicPastor[];
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>(membersOnly ? "verify" : "type");
  const [contact, setContact] = useState("");
  const [otpId, setOtpId] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [pastorId, setPastorId] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", topic: "" });
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BookingSuccess | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);

  const type = types.find((x) => x.id === typeId) ?? null;
  const offering = pastors.filter((p) => typeId && p.typeIds.includes(typeId));
  const pastor = pastors.find((p) => p.id === pastorId) ?? null;
  const length = (ty: PublicType) => ty.durationMinutes ?? null;

  const guarded = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        console.error("[book] request failed", e);
        setError(t("pastoral.errors.network"));
      }
    });
  };

  const chooseType = (id: string) => {
    setTypeId(id);
    setStartsAt(null);
    const who = pastors.filter((p) => p.typeIds.includes(id));
    // One pastor offers it: no question to ask.
    if (who.length === 1) {
      setPastorId(who[0].id);
      setStep("time");
    } else {
      setPastorId(null);
      setStep("pastor");
    }
  };

  const back = () => {
    setError(null);
    if (step === "pastor") setStep("type");
    else if (step === "time") setStep(offering.length > 1 ? "pastor" : "type");
    else if (step === "details") setStep("time");
    else if (step === "code") setStep("verify");
  };

  const noTimes = publicPhone
    ? t("pastoral.public.noTimesCall", { days: 14, phone: publicPhone })
    : t("pastoral.public.noTimes", { days: 14 });

  if (membersUnavailable) {
    return <p className="text-muted-foreground text-sm">{t("pastoral.page.secretMissing")}</p>;
  }
  if (types.length === 0 && step !== "verify" && step !== "code") {
    return <p className="text-muted-foreground text-sm">{t("pastoral.public.noTypes")}</p>;
  }

  const errorBox = error && (
    <p role="alert" className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-3 py-2 text-sm">
      {error}
    </p>
  );

  const backButton = (
    <Button type="button" variant="ghost" size="sm" className="min-h-11 -ml-2" onClick={back}>
      <ChevronLeft className="size-4" /> {t("common.back")}
    </Button>
  );

  if (step === "verify") {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">{t("pastoral.public.verifyTitle")}</h2>
          <p className="text-muted-foreground text-sm">{t("pastoral.public.verifyBody")}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bk-contact">{t("pastoral.public.contact")}</Label>
          <Input
            id="bk-contact"
            type="text"
            inputMode="email"
            autoComplete="email"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
        </div>
        {errorBox}
        <Button
          className="min-h-11 w-full"
          disabled={pending || contact.trim().length < 5}
          onClick={() =>
            guarded(async () => {
              const res = await startMemberVerification(slug, contact);
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setOtpId(res.otpId);
              setNotice(res.message);
              setStep("code");
            })
          }
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {t("pastoral.public.sendCode")}
        </Button>
      </div>
    );
  }

  if (step === "code") {
    return (
      <div className="space-y-4">
        {backButton}
        {notice && <p className="text-muted-foreground text-sm">{notice}</p>}
        <div className="space-y-1.5">
          <Label htmlFor="bk-code">{t("pastoral.public.verifyCode")}</Label>
          <Input
            id="bk-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="text-center text-2xl tracking-[0.4em]"
          />
        </div>
        {errorBox}
        <Button
          className="min-h-11 w-full"
          disabled={pending || code.length !== 6}
          onClick={() =>
            guarded(async () => {
              const res = await verifyMemberCode(slug, otpId, code);
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setTicket(res.ticket);
              setFirstName(res.firstName);
              // Back from an expired proof: straight to the details they had filled in.
              setStep(typeId && pastorId && startsAt ? "details" : "type");
            })
          }
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {t("pastoral.public.checkCode")}
        </Button>
      </div>
    );
  }

  if (step === "done" && result) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
            <CalendarCheck className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold">
              {result.status === "pending" ? t("pastoral.public.pendingTitle") : t("pastoral.public.confirmedTitle")}
            </h2>
            {result.status === "pending" && (
              <p className="text-muted-foreground text-sm">{t("pastoral.public.pendingBody", { pastor: result.pastorName })}</p>
            )}
          </div>
        </div>
        {result.when && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("pastoral.public.whenLabel")}</dt>
            <dd className="font-semibold">{result.when}</dd>
            <dt className="text-muted-foreground">{t("pastoral.public.withLabel")}</dt>
            <dd>
              {result.typeName} · {result.pastorName}
            </dd>
          </dl>
        )}
        {result.when && <p className="text-muted-foreground text-xs">{t("pastoral.public.timesIn", { zone: result.zone })}</p>}
        {result.manageUrl && (
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">{t("pastoral.public.manageLink")}</p>
            <div className="flex gap-2">
              <Input readOnly value={result.manageUrl} className="font-mono text-xs" aria-label={t("pastoral.public.manageLink")} />
              <Button
                variant="outline"
                size="icon"
                className="size-11 shrink-0"
                aria-label={t("common.copyLink")}
                onClick={() =>
                  navigator.clipboard.writeText(result.manageUrl).then(
                    () => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    },
                    () => setError(t("pastoral.page.copyFailed")),
                  )
                }
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>
        )}
        {result.emailFailed && <p className="text-sm text-amber-700 dark:text-amber-300">{t("pastoral.public.deliveryEmailFailed")}</p>}
        {result.smsQueued && <p className="text-muted-foreground text-sm">{t("pastoral.public.deliverySmsQueued")}</p>}
        {errorBox}
        <div className="flex flex-col gap-2 sm:flex-row">
          {result.ics && (
            <Button variant="outline" className="min-h-11" onClick={() => result.ics && downloadIcs(result.ics)}>
              <CalendarPlus className="size-4" /> {t("pastoral.public.addToCalendar")}
            </Button>
          )}
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() => {
              setResult(null);
              setStartsAt(null);
              setStep("type");
            }}
          >
            {t("pastoral.public.bookAnother")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {firstName && step === "type" && <p className="text-sm font-semibold">{t("pastoral.public.hello", { name: firstName })}</p>}
      {step !== "type" && backButton}

      {step === "type" && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold">{t("pastoral.public.chooseType")}</h2>
          <ul className="space-y-2">
            {types.map((ty) => (
              <li key={ty.id}>
                <button
                  type="button"
                  onClick={() => chooseType(ty.id)}
                  className="hover:bg-muted min-h-11 w-full rounded-xl border px-4 py-3 text-left transition"
                >
                  <span className="block font-semibold">{ty.name}</span>
                  <span className="text-muted-foreground block text-xs">
                    {t(locationKey(ty.location))}
                    {length(ty) ? ` · ${t("pastoral.ui.minutes", { count: length(ty) as number })}` : ""}
                    {ty.requiresApproval ? ` · ${t("pastoral.public.needsConfirm")}` : ""}
                  </span>
                  {ty.description && <span className="text-muted-foreground mt-1 block text-sm">{ty.description}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {step === "pastor" && type && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold">{t("pastoral.public.choosePastor")}</h2>
          {offering.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("pastoral.public.noPastors")}</p>
          ) : (
            <ul className="space-y-2">
              {offering.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPastorId(p.id);
                      setStartsAt(null);
                      setStep("time");
                    }}
                    className={cn(
                      "hover:bg-muted min-h-11 w-full rounded-xl border px-4 py-3 text-left transition",
                      pastorId === p.id && "border-primary",
                    )}
                  >
                    <span className="block font-semibold">{p.displayName}</span>
                    {p.title && <span className="text-muted-foreground block text-xs">{p.title}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step === "time" && type && pastor && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold">{t("pastoral.public.chooseTime")}</h2>
          <p className="text-muted-foreground text-sm">
            {type.name} · {pastor.displayName}
          </p>
          <SlotPicker
            key={`${pastor.id}:${type.id}`}
            load={(from) => listOpenSlots(slug, pastor.id, type.id, from)}
            initialFromDay={today}
            value={startsAt}
            onChange={setStartsAt}
            emptyText={noTimes}
            reloadKey={reloadKey}
          />
          {errorBox}
          <Button className="min-h-11 w-full" disabled={!startsAt} onClick={() => setStep("details")}>
            {t("pastoral.public.continue")}
          </Button>
        </div>
      )}

      {step === "details" && type && pastor && startsAt && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            guarded(async () => {
              const res = await submitBooking(
                slug,
                {
                  pastorId: pastor.id,
                  typeId: type.id,
                  startsAt,
                  ...(membersOnly ? {} : { name: form.name, phone: form.phone, email: form.email }),
                  address: form.address,
                  topic: form.topic,
                  ticket: ticket ?? undefined,
                },
                honeypot,
              );
              if (!res.ok) {
                setError(res.error);
                if (res.reverify) {
                  // The choices and details stay; only the code step is asked again.
                  setTicket(null);
                  setCode("");
                  setStep("verify");
                  return;
                }
                if (res.taken) {
                  setStartsAt(null);
                  setReloadKey((k) => k + 1);
                  setStep("time");
                }
                return;
              }
              setResult(res);
              setStep("done");
            });
          }}
        >
          <h2 className="text-lg font-bold">{t("pastoral.public.yourDetails")}</h2>
          {!membersOnly && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="bk-name">{t("pastoral.public.name")}</Label>
                <Input
                  id="bk-name"
                  autoComplete="name"
                  required
                  maxLength={120}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bk-phone">{t("pastoral.public.phone")}</Label>
                <Input
                  id="bk-phone"
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bk-email">{t("pastoral.public.email")}</Label>
                <Input
                  id="bk-email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
                <p className="text-muted-foreground text-xs">{t("pastoral.public.needContact")}</p>
              </div>
            </>
          )}
          {type.location === "home" && (
            <div className="space-y-1.5">
              <Label htmlFor="bk-address">{t("pastoral.public.address")}</Label>
              <Input
                id="bk-address"
                autoComplete="street-address"
                required
                maxLength={300}
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="bk-topic">{t("pastoral.public.topic")}</Label>
            <Textarea
              id="bk-topic"
              maxLength={1000}
              value={form.topic}
              onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
            />
            <p className="text-muted-foreground text-xs">{t("pastoral.public.topicPrivate")}</p>
          </div>
          {/* A field no person can see. Bots fill it in; people do not. */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
            <label htmlFor="bk-company">{t("pastoral.public.honeypot")}</label>
            <input
              id="bk-company"
              name="company"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>
          {errorBox}
          <Button type="submit" className="min-h-11 w-full" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("pastoral.public.submit")}
          </Button>
          <p className="text-muted-foreground text-center text-xs">{churchName}</p>
        </form>
      )}
    </div>
  );
}
