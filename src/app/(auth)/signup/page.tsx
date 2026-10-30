"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, CircleCheck, Loader2, MailCheck, Tag } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import {
  capturedReferral,
  checkReferralCode,
  checkSignupEmail,
  checkSignupPhone,
  createChurchAccount,
  detectCountry,
  type FieldCheck,
  type ReferralCheck,
} from "./actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/geo";
import {
  countryProfile,
  smsAvailableForCountry,
} from "@/lib/country-profile";
import { CURRENCIES } from "@/lib/money";
import { ORG_TYPES, cleanOrgType, type OrgType } from "@/lib/org-type";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

/**
 * Ask the server about one field, when the person leaves it.
 *
 * On BLUR rather than on every keystroke, deliberately: telling somebody their
 * email address is already taken while they are still halfway through typing it
 * is noise, and it is a lookup per character for an answer that cannot be right
 * yet.
 *
 * The answer is stored WITH the value it is about, and only rendered while the
 * box still holds that value. That is what makes editing a field put its own
 * warning away, and what makes typing the same thing again bring the warning
 * back without another round trip — the alternative, clearing a flag on change,
 * silently stops warning about a value it has already warned about once.
 */
function useBlurCheck<T>(
  ask: (value: string) => Promise<T>,
  /**
   * Anything else the answer depends on — for the phone box, the country,
   * because a different dial code can make the same digits a different number.
   * An answer is only ever shown against the question it was asked.
   */
  question = "",
) {
  const [answer, setAnswer] = useState<{
    question: string;
    value: string;
    result: T;
  } | null>(null);
  /** The value currently being asked about, so the spinner knows which box. */
  const [busy, setBusy] = useState<string | null>(null);
  const seq = useRef(0);
  /** The last question we put, so one blur is never two lookups. */
  const asked = useRef<string | null>(null);

  const check = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      const put = `${question}\u0000${value}`;
      if (put === asked.current) return;
      asked.current = put;
      const mine = ++seq.current;
      setBusy(value);
      try {
        const result = await ask(value);
        if (mine === seq.current) setAnswer({ question, value, result });
      } catch (e) {
        // A check that cannot run is not a reason to say anything: the field
        // falls silent, and the server has the last word on submit anyway.
        console.error("[signup] a field check could not run", e);
        if (mine === seq.current) {
          setAnswer(null);
          asked.current = null; // so leaving the field again retries
        }
      } finally {
        if (mine === seq.current) setBusy(null);
      }
    },
    [ask, question],
  );

  /** An answer we already know, without asking again. */
  const seed = useCallback(
    (value: string, result: T) => {
      asked.current = `${question}\u0000${value.trim()}`;
      setAnswer({ question, value: value.trim(), result });
    },
    [question],
  );

  /** The answer — but only while it still describes what is in the box. */
  const resultFor = useCallback(
    (raw: string): T | null =>
      answer && answer.question === question && answer.value === raw.trim()
        ? answer.result
        : null,
    [answer, question],
  );

  const busyFor = useCallback(
    (raw: string): boolean => busy !== null && busy === raw.trim(),
    [busy],
  );

  return { check, seed, resultFor, busyFor };
}

/** One line under a field. Never more than one, and never empty. */
function FieldNote({
  tone,
  children,
}: {
  tone: "bad" | "warn" | "good" | "quiet";
  children: ReactNode;
}) {
  const colour =
    tone === "bad"
      ? "text-destructive"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "good"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-muted-foreground";
  const Icon = tone === "good" ? CircleCheck : CircleAlert;
  return (
    <p className={`flex items-start gap-1.5 text-xs leading-relaxed ${colour}`}>
      {tone !== "quiet" && <Icon className="mt-px size-3.5 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

function Checking({ label }: { label: string }) {
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <Loader2 className="size-3 animate-spin" />
      {label}
    </p>
  );
}

function SignupForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirect") || "";
  // Invitees land here with ?redirect=/accept-invitation/<id>. They should
  // create a personal account and join an existing church — NOT make a new one.
  const inviteMode = redirectTo.startsWith("/accept-invitation");

  const [loading, setLoading] = useState(false);
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  /*
   * What they are setting up. Church first and preselected, because most
   * people who arrive here run one and should not have to answer anything new.
   * `?type=fellowship` preselects another, so a page written for fellowships
   * can link straight to a form that already speaks to them.
   */
  const [orgType, setOrgType] = useState<OrgType>(() =>
    cleanOrgType(params.get("type")),
  );

  /*
   * Cloudflare's guess, applied once as the field's starting value.
   *
   * Deliberately not forced: this only moves the dropdown before anybody has
   * touched it. A pastor who has already chosen keeps their choice.
   */
  useEffect(() => {
    let live = true;
    detectCountry()
      .then((c) => {
        if (live && c) setCountry(c);
      })
      .catch(() => {
        // No geolocation is not an error; the dropdown already has a value.
      });
    return () => {
      live = false;
    };
  }, []);

  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);

  /* ----- the three fields that answer back ----- */
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  /*
   * `partnerLink()` has always generated `/signup?ref=<code>` and until now
   * nothing on this page looked at it. Read during render rather than in an
   * effect, so the box is filled in on the first paint instead of appearing
   * to fill itself in a moment later.
   */
  const refFromUrl = (params.get("ref") || params.get("code") || "").trim();
  const [referral, setReferral] = useState(refFromUrl);
  const [showReferral, setShowReferral] = useState(refFromUrl !== "");
  /** What is in the referral box right now, readable from a callback. */
  const typedReferral = useRef(refFromUrl);

  const emailCheck = useBlurCheck<FieldCheck>(checkSignupEmail);
  const phoneCheck = useBlurCheck<FieldCheck>(
    useCallback((value: string) => checkSignupPhone(value, country), [country]),
    country,
  );
  const refCheck = useBlurCheck<ReferralCheck>(checkReferralCode);

  /*
   * A code that is already on this browser, shown rather than applied in
   * silence.
   *
   * Somebody who followed an agent's `/a/bc3k9m` link has the attribution in a
   * cookie they cannot see. Filling the box in and naming who gets the credit
   * lets them confirm it — or clear it, which matters just as much: a cookie
   * from a link clicked three weeks ago should not quietly credit somebody they
   * have never spoken to.
   *
   * A code in the URL is checked instead, so it is confirmed the same way.
   */
  const seedReferral = refCheck.seed;
  const askReferral = refCheck.check;
  useEffect(() => {
    if (inviteMode) return;
    if (refFromUrl) {
      void askReferral(refFromUrl);
      return;
    }
    let live = true;
    capturedReferral()
      .then((found) => {
        // Never over-write somebody who has started typing their own code
        // while this was in flight: what they declared beats what we captured.
        if (!live || !found || typedReferral.current.trim()) return;
        typedReferral.current = found.code;
        setReferral(found.code);
        setShowReferral(true);
        seedReferral(found.code, { state: "ok", ...found });
      })
      .catch((e) => {
        // Nothing to show is the normal case; a failure here only means the
        // box starts empty, which it would have done anyway.
        console.error("[signup] could not read a captured referral", e);
      });
    return () => {
      live = false;
    };
  }, [inviteMode, refFromUrl, askReferral, seedReferral]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name")).trim();
    const password = String(form.get("password"));

    setLoading(true);
    try {
      if (inviteMode) {
        // Create just the user account (no church), then return to the
        // invitation page to accept. After email verification (if on), the
        // callback brings them back to the same accept page.
        const { data, error } = await authClient.signUp.email({
          name,
          email: email.trim(),
          password,
          callbackURL: redirectTo,
        });
        if (error) {
          toast.error(error.message || "Could not create your account.");
          return;
        }
        if (data?.token) {
          // Verification disabled → signed in; go straight to accept.
          router.push(redirectTo);
          router.refresh();
        } else {
          // Verification required → confirm email, then the callback returns
          // them to the accept page.
          setVerifyEmail(email.trim());
        }
        return;
      }

      // Normal sign-up: create the user AND their organisation in one server step.
      const churchName = String(form.get("churchName")).trim();
      const result = await createChurchAccount({
        churchName,
        orgType,
        name,
        email: email.trim(),
        password,
        country,
        phone: phone.trim(),
        referralCode: referral.trim(),
      });

      if (!result.ok) {
        toast.error(result.error);
        if (result.needsOnboarding) router.push("/onboarding");
        return;
      }

      if (result.signedIn) {
        toast.success(`Welcome to FlockInsight, ${name.split(" ")[0]}!`);
        router.push("/dashboard");
        router.refresh();
      } else {
        setVerifyEmail(email.trim());
      }
    } catch (e) {
      /*
       * Without this, a server action that throws left the button to stop
       * spinning and said nothing at all — the one rendered state that means
       * "we have no idea what happened" looking exactly like "nothing
       * happened". Whatever broke, the person gets a sentence.
       */
      console.error("[signup] could not complete sign-up", e);
      toast.error(
        "Something went wrong creating your account. Please try again, or contact us if it keeps happening.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (verifyEmail) {
    return (
      <Card className="shadow-lg">
        <CardHeader className="text-center">
          <div className="bg-primary/10 text-primary mx-auto mb-2 grid size-12 place-items-center rounded-full">
            <MailCheck className="size-6" />
          </div>
          <CardTitle className="text-2xl">{t("common.checkYourInbox")}</CardTitle>
          <CardDescription>
            {t("auth.accountReady")}{" "}
            We sent a verification link to{" "}
            <span className="text-foreground font-semibold">{verifyEmail}</span>.
            Confirm your email
            {inviteMode
              ? " to finish accepting your invitation."
              : ", then log in to continue."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="lg" className="w-full">
            <Link
              href={
                inviteMode
                  ? `/login?redirect=${encodeURIComponent(redirectTo)}`
                  : "/login"
              }
            >
              Go to login
            </Link>
          </Button>
          <p className="text-muted-foreground mt-4 text-center text-xs">
            Didn&apos;t get the email? Check your spam folder, or wait a minute
            and try logging in to request a new link.
          </p>
        </CardContent>
      </Card>
    );
  }

  const emailNote = emailCheck.resultFor(email);
  const phoneNote = phoneCheck.resultFor(phone);
  const referralNote = refCheck.resultFor(referral);

  return (
    <Card className="shadow-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">{t("auth.createYourAccount")}</CardTitle>
        <CardDescription>
          {inviteMode
            ? "Set up your account to accept the invitation you were sent."
            : "Free 30-day trial · No credit card required"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {/*
            One tap, already answered for the common case. The only thing it
            changes on this form is the wording of the box below it — a
            fellowship asked for its "Church name" reads that as "not for you".
            Every type gets the same account, plans and modules.
          */}
          {!inviteMode && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm leading-none font-medium">
                {t("orgType.question")}
              </legend>
              <div className="flex flex-wrap gap-2">
                {ORG_TYPES.map((type) => (
                  <label
                    key={type}
                    className={cn(
                      "has-[:focus-visible]:ring-ring/50 flex min-h-9 cursor-pointer items-center rounded-full border px-3 text-sm transition-colors has-[:focus-visible]:ring-[3px]",
                      orgType === type
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "hover:bg-muted text-muted-foreground",
                    )}
                  >
                    <input
                      type="radio"
                      name="orgType"
                      value={type}
                      checked={orgType === type}
                      onChange={() => setOrgType(type)}
                      className="sr-only"
                    />
                    {t(`orgType.${type}.label`)}
                  </label>
                ))}
              </div>
              <FieldNote tone="quiet">{t(`orgType.${orgType}.hint`)}</FieldNote>
            </fieldset>
          )}
          {!inviteMode && (
            <div className="space-y-2">
              <Label htmlFor="churchName">{t(`orgType.${orgType}.name`)}</Label>
              <Input
                id="churchName"
                name="churchName"
                placeholder={t(`orgType.${orgType}.placeholder`)}
                required
              />
            </div>
          )}
          {!inviteMode && (
            <div className="space-y-2">
              <Label htmlFor="country">{t("common.country")}</Label>
              <select
                id="country"
                name="country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="border-input bg-background focus-visible:ring-ring/50 h-11 w-full rounded-lg border px-3 text-base focus-visible:ring-[3px] focus-visible:outline-none sm:h-10 md:text-sm"
              >
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {/*
                Said before they commit, not discovered afterwards. Country
                decides the money their giving is recorded in and the language
                the app opens in — and whether SMS is even offered, which is
                the one people are most likely to assume.
              */}
              <p className="text-muted-foreground text-xs leading-relaxed">
                Sets your currency to{" "}
                <strong>
                  {CURRENCIES.find((x) => x.code === countryProfile(country).currency)
                    ?.label ?? countryProfile(country).currency}
                </strong>
                .{" "}
                {smsAvailableForCountry(country)
                  ? "Email and SMS are both available."
                  : "Email is free and unlimited. SMS isn't available here yet, so we won't offer it."}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">{t("common.yourName")}</Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              placeholder={
                // "Pastor" suits a church; a campus fellowship is led by a student.
                !inviteMode && orgType !== "church"
                  ? t("auth.eGMaryJohnson")
                  : t("common.pastorJohnAdeyemi")
              }
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{t("common.email")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={(e) => void emailCheck.check(e.target.value)}
              aria-invalid={emailNote?.state === "taken" || undefined}
              required
            />
            {inviteMode && (
              <p className="text-muted-foreground text-xs">
                Use the same email address your invitation was sent to.
              </p>
            )}
            {emailCheck.busyFor(email) ? (
              <Checking label={t("auth.checking")} />
            ) : emailNote?.state === "taken" ? (
              <FieldNote tone="bad">
                {emailNote.message}{" "}
                <Link
                  href={
                    inviteMode
                      ? `/login?redirect=${encodeURIComponent(redirectTo)}`
                      : "/login"
                  }
                  className="font-semibold underline"
                >
                  {t("auth.logInInstead")}
                </Link>
                .
              </FieldNote>
            ) : emailNote?.state === "invalid" ? (
              <FieldNote tone="warn">{emailNote.message}</FieldNote>
            ) : null}
          </div>

          {!inviteMode && (
            <div className="space-y-2">
              {/*
                No "(optional)" on the label, on purpose. A field announced as
                optional is a field most people skip, and this is the number
                support needs on the one day it matters. It is genuinely not
                required — the form submits without it — and the line under it
                says what it is for rather than that it can be left out.
              */}
              <Label htmlFor="phone">{t("common.phoneNumber")}</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={`e.g. +${countryProfile(country).dial} …`}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={(e) => void phoneCheck.check(e.target.value)}
              />
              {phoneCheck.busyFor(phone) ? (
                <Checking label={t("auth.checking")} />
              ) : phoneNote?.state === "taken" ? (
                <FieldNote tone="warn">{phoneNote.message}</FieldNote>
              ) : phoneNote?.state === "invalid" ? (
                <FieldNote tone="warn">{phoneNote.message}</FieldNote>
              ) : (
                <FieldNote tone="quiet">{t("auth.phoneWhy")}</FieldNote>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="password">{t("common.password")}</Label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              placeholder={t("common.atLeast8Characters")}
              minLength={8}
              required
            />
          </div>

          {/*
            Folded away until it is wanted.

            Most churches arrive without a code, and a sixth box they have to
            read and skip is friction for all of them. The ones who do have a
            code are either holding a card or were sent a link — and a link
            opens this section already filled in, with the name of whoever gets
            the credit under it.
          */}
          {!inviteMode &&
            (showReferral ? (
              <div className="space-y-2">
                <Label htmlFor="referralCode">{t("common.referralCode")}</Label>
                <Input
                  id="referralCode"
                  name="referralCode"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={t("auth.referralCodeExample")}
                  value={referral}
                  onChange={(e) => {
                    typedReferral.current = e.target.value;
                    setReferral(e.target.value);
                  }}
                  onBlur={(e) => void refCheck.check(e.target.value)}
                  aria-invalid={referralNote?.state === "unknown" || undefined}
                />
                {refCheck.busyFor(referral) ? (
                  <Checking label={t("auth.checking")} />
                ) : referralNote?.state === "ok" ? (
                  <FieldNote tone="good">
                    {referralNote.kind === "partner"
                      ? t("auth.referralPartnerCredited", { name: referralNote.label })
                      : t("auth.referralByChurch", { name: referralNote.label })}
                  </FieldNote>
                ) : referralNote?.state === "unknown" ? (
                  <FieldNote tone="bad">{t("auth.referralUnknown")}</FieldNote>
                ) : (
                  <FieldNote tone="quiet">{t("auth.referralWhy")}</FieldNote>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowReferral(true)}
                className="text-muted-foreground hover:text-primary -my-1 flex min-h-11 items-center gap-1.5 py-2 text-xs font-medium sm:min-h-0"
              >
                <Tag className="size-3.5" />
                {t("auth.haveReferralCode")}
              </button>
            ))}

          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            {inviteMode ? "Create account & continue" : "Create free account"}
          </Button>
          <p className="text-muted-foreground text-center text-xs">
            By creating an account you agree to our{" "}
            <Link href="/terms" className="hover:text-primary underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="hover:text-primary underline">
              Privacy Policy
            </Link>
            .
          </p>
        </form>

        <p className="text-muted-foreground mt-6 text-center text-sm">
          Already have an account?{" "}
          <Link
            href={
              inviteMode
                ? `/login?redirect=${encodeURIComponent(redirectTo)}`
                : "/login"
            }
            className="text-primary font-semibold hover:underline"
          >
            Log in
          </Link>
        </p>
        {/* This form makes an ORGANISATION. Somebody who only wants to bring
            others in must not have to invent one to get an account. */}
        {!inviteMode && (
          <p className="text-muted-foreground mt-2 text-center text-xs">
            {t("auth.onlyReferring")}{" "}
            <Link
              href="/partner/join"
              className="text-primary font-semibold hover:underline"
            >
              {t("auth.becomeAPartner")}
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
