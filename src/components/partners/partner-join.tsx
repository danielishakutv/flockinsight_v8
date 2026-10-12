"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2, LogIn, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { signOut } from "@/lib/auth-client";
import { applyToBePartner, createPartnerAccount } from "@/app/partner/actions";
import { checkSignupEmail, type FieldCheck } from "@/app/(auth)/signup/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

/** Log in, then come straight back to this page to finish joining. */
const LOGIN_AND_RETURN = "/login?redirect=%2Fpartner%2Fjoin";

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-muted-foreground mb-1 block text-xs font-semibold uppercase"
    >
      {children}
    </label>
  );
}

function PhoneField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <FieldLabel htmlFor="partner-phone">Phone number</FieldLabel>
      {/* type/inputMode tel: the number pad, not a full keyboard, for the
          number they will have to verify by SMS before they can withdraw. */}
      <Input
        id="partner-phone"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="08012345678"
      />
      <p className="text-muted-foreground mt-1 text-xs">
        We verify this before paying you, so use the number you actually
        answer.
      </p>
    </div>
  );
}

/** "Grace Chapel", "Grace Chapel and Hope House", or "your 3 churches". */
function churchPhrase(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `your ${names.length} churches`;
}

/**
 * Join with the account you are signed in with.
 *
 * Says which account, and what happens to the church side of it — nothing —
 * because "Apply" on a page reached from inside a church app reads, to a
 * pastor, uncomfortably like it might do something to their church.
 */
export function PartnerJoin({
  defaultName,
  email,
  churchNames,
}: {
  defaultName: string;
  email: string;
  churchNames: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [displayName, setDisplayName] = useState(defaultName);
  const [phone, setPhone] = useState("");
  const [switching, setSwitching] = useState(false);

  function apply() {
    startTransition(async () => {
      const res = await applyToBePartner({ displayName, phone });
      if (!res.ok) return void toast.error(res.error);
      toast.success("You're in. Here is your dashboard.");
      router.push("/partner");
      router.refresh();
    });
  }

  async function notMe() {
    setSwitching(true);
    const { error } = await signOut();
    setSwitching(false);
    if (error) {
      toast.error(error.message || "We couldn't sign you out. Try again.");
      return;
    }
    // Same page, signed out: it now offers a new account or another login.
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="bg-muted/50 rounded-lg p-3 text-sm">
        <p>
          You&rsquo;re signed in as{" "}
          <strong className="break-all">{email}</strong>. Joining adds a
          Partner dashboard to this same login
          {churchNames.length > 0 ? (
            <>
              {" "}
              &mdash; {churchPhrase(churchNames)} stays exactly as it is, and
              you move between the two from your account menu.
            </>
          ) : (
            "."
          )}
        </p>
        <p className="text-muted-foreground mt-1.5 text-xs">
          Not you, or want to use a different account?{" "}
          <button
            type="button"
            onClick={notMe}
            disabled={switching}
            className="text-primary font-semibold underline disabled:opacity-60"
          >
            Sign out
          </button>
        </p>
      </div>
      <div>
        <FieldLabel htmlFor="partner-name">Your name</FieldLabel>
        <Input
          id="partner-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="As churches will know you"
        />
      </div>
      <PhoneField value={phone} onChange={setPhone} />
      <Button onClick={apply} disabled={pending || displayName.trim().length < 2}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Join as a Partner
      </Button>
      <p className="text-muted-foreground text-xs">
        You can start sharing your link straight away. Approval is needed before
        your first withdrawal, not before your first church.
      </p>
    </div>
  );
}

/**
 * For somebody with no session: a Partner-only account, or the login they
 * already have.
 *
 * The "already have one" box comes FIRST. Most early Partners are pastors and
 * church administrators already on FlockInsight, and a second account under a
 * second address would split their church from their commission for good.
 */
export function PartnerSignup() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<{
    message: string;
    existingAccount: boolean;
  } | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  /*
   * The email box answers on blur, as on the church sign-up. The answer is
   * kept with the address it is about, so editing the box puts it away.
   */
  const [emailAnswer, setEmailAnswer] = useState<{
    value: string;
    result: FieldCheck;
  } | null>(null);
  async function checkEmail(raw: string) {
    const value = raw.trim();
    if (!value) return;
    try {
      setEmailAnswer({ value, result: await checkSignupEmail(value) });
    } catch (e) {
      // A check that cannot run says nothing; the server decides on submit.
      console.error("[partners] email check could not run", e);
      setEmailAnswer(null);
    }
  }
  const emailNote =
    emailAnswer && emailAnswer.value === email.trim() ? emailAnswer.result : null;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProblem(null);
    startTransition(async () => {
      try {
        const res = await createPartnerAccount({ name, email, phone, password });
        if (!res.ok) {
          setProblem({
            message: res.error,
            existingAccount: !!res.existingAccount,
          });
          return;
        }
        if (res.signedIn) {
          toast.success(`Welcome, ${name.trim().split(" ")[0]}. Here is your dashboard.`);
          router.push("/partner");
          router.refresh();
        } else {
          setSentTo(email.trim());
        }
      } catch (err) {
        console.error("[partners] sign-up could not complete", err);
        setProblem({
          message:
            "Something went wrong creating your account. Try again, or email partners@flockinsight.com if it keeps happening.",
          existingAccount: false,
        });
      }
    });
  }

  if (sentTo) {
    return (
      <div className="space-y-3 rounded-xl border p-5 text-center">
        <div className="bg-primary/10 text-primary mx-auto grid size-12 place-items-center rounded-full">
          <MailCheck className="size-6" />
        </div>
        <p className="text-lg font-bold">Check your inbox</p>
        <p className="text-muted-foreground text-sm">
          Your Partner account is ready. We sent a link to{" "}
          <strong className="text-foreground break-all">{sentTo}</strong> —
          opening it confirms your email and signs you in to your Partner
          dashboard.
        </p>
        <p className="text-muted-foreground text-xs">
          Nothing there? Check your spam folder, or{" "}
          <Link href="/login?redirect=%2Fpartner" className="text-primary font-semibold underline">
            log in
          </Link>{" "}
          to have a new link sent.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border-primary/30 bg-primary/5 space-y-2 rounded-xl border p-4">
        <p className="font-semibold">Already on FlockInsight?</p>
        <p className="text-muted-foreground text-sm">
          If you run a church, serve on a church team or have any FlockInsight
          login, you don&rsquo;t need a second account. Log in with it and we
          add Partner to the same login &mdash; your church stays exactly as it
          is.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href={LOGIN_AND_RETURN}>
            <LogIn className="size-4" />
            Log in and join
          </Link>
        </Button>
      </div>

      <form onSubmit={submit} className="space-y-3 rounded-xl border p-4">
        <div>
          <p className="font-semibold">New here? Create a Partner account</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            A login for the Partner programme only &mdash; no church is set up.
            If you start a church later, it goes on this same login.
          </p>
        </div>
        <div>
          <FieldLabel htmlFor="partner-name">Your name</FieldLabel>
          <Input
            id="partner-name"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="As churches will know you"
            required
          />
        </div>
        <div>
          <FieldLabel htmlFor="partner-email">Email</FieldLabel>
          <Input
            id="partner-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={(e) => void checkEmail(e.target.value)}
            aria-invalid={emailNote?.state === "taken" || undefined}
            placeholder="you@example.com"
            required
          />
          {emailNote?.state === "taken" ? (
            <p className="text-destructive mt-1 flex items-start gap-1.5 text-xs">
              <CircleAlert className="mt-px size-3.5 shrink-0" />
              <span>
                That email already has a FlockInsight account.{" "}
                <Link href={LOGIN_AND_RETURN} className="font-semibold underline">
                  Log in with it to add Partner
                </Link>
                .
              </span>
            </p>
          ) : emailNote?.state === "invalid" ? (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {emailNote.message}
            </p>
          ) : null}
        </div>
        <PhoneField value={phone} onChange={setPhone} />
        <div>
          <FieldLabel htmlFor="partner-password">Password</FieldLabel>
          <PasswordInput
            id="partner-password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            minLength={8}
            required
          />
        </div>

        {problem && (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm"
          >
            <p>{problem.message}</p>
            {problem.existingAccount && (
              <Button asChild size="sm" className="mt-2">
                <Link href={LOGIN_AND_RETURN}>
                  <LogIn className="size-4" />
                  Log in and join
                </Link>
              </Button>
            )}
          </div>
        )}

        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending && <Loader2 className="size-4 animate-spin" />}
          Create my Partner account
        </Button>
        <p className="text-muted-foreground text-xs">
          By creating an account you agree to our{" "}
          <Link href="/terms" className="hover:text-primary underline">
            Terms
          </Link>
          ,{" "}
          <Link href="/privacy" className="hover:text-primary underline">
            Privacy Policy
          </Link>{" "}
          and the{" "}
          <Link href="/partners" className="hover:text-primary underline">
            Partner programme terms
          </Link>
          . Approval is needed before your first withdrawal, not before your
          first church.
        </p>
      </form>
    </div>
  );
}
