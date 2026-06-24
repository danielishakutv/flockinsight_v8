"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { signIn, signOut, organization } from "@/lib/auth-client";
import {
  acceptInvite,
  joinAsNewUser,
} from "@/app/accept-invitation/actions";
import { Wordmark } from "@/components/brand";
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

export type AcceptMode =
  | "invalid"
  | "used"
  | "expired"
  | "joined"
  | "accept"
  | "wrongUser"
  | "login"
  | "signup";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-8">
        <Wordmark logoClassName="size-10" className="text-2xl" />
      </div>
      <Card className="w-full max-w-md shadow-lg">{children}</Card>
    </div>
  );
}

export function AcceptInvitation({
  id,
  mode: initialMode,
  churchName,
  email,
  sessionEmail,
}: {
  id: string;
  mode: AcceptMode;
  churchName: string | null;
  email: string | null;
  sessionEmail: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<AcceptMode>(initialMode);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const church = churchName || "the church";

  function goDashboard() {
    router.push("/dashboard");
    router.refresh();
  }

  async function setActiveAndGo(organizationId: string) {
    try {
      await organization.setActive({ organizationId });
    } catch {
      /* the login hook also sets the active church; ignore */
    }
    toast.success(`Welcome to ${church}!`);
    goDashboard();
  }

  function doAccept() {
    startTransition(async () => {
      const res = await acceptInvite(id);
      if (!res.ok) {
        toast.error(res.error);
        if (res.code === "WRONG_USER") setMode("wrongUser");
        return;
      }
      await setActiveAndGo(res.organizationId);
    });
  }

  function doSignup() {
    if (!name.trim()) return toast.error("Please enter your name.");
    if (password.length < 8)
      return toast.error("Password must be at least 8 characters.");
    startTransition(async () => {
      const res = await joinAsNewUser(id, name, password);
      if (!res.ok) {
        if (res.code === "EXISTS") {
          toast.info("You already have an account — please log in.");
          setMode("login");
          return;
        }
        toast.error(res.error);
        return;
      }
      // Account created + joined; sign them in to start the session.
      const { error } = await signIn.email({
        email: email ?? "",
        password,
      });
      if (error) {
        toast.success("Account created. Please log in to continue.");
        router.push(
          `/login?redirect=${encodeURIComponent(`/accept-invitation/${id}`)}`,
        );
        return;
      }
      await setActiveAndGo(res.organizationId);
    });
  }

  function doLogin() {
    if (!password) return toast.error("Enter your password.");
    startTransition(async () => {
      const { error } = await signIn.email({ email: email ?? "", password });
      if (error) {
        if (error.status === 403 || error.code === "EMAIL_NOT_VERIFIED") {
          toast.error("Please verify your email, then try again.");
          return;
        }
        toast.error(error.message || "Wrong password. Please try again.");
        return;
      }
      const res = await acceptInvite(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      await setActiveAndGo(res.organizationId);
    });
  }

  function doSignOut() {
    startTransition(async () => {
      await signOut();
      router.refresh();
    });
  }

  // ---- Terminal states -------------------------------------------------

  if (mode === "joined") {
    return (
      <Shell>
        <CardHeader className="text-center">
          <div className="bg-success/10 text-success mx-auto mb-2 grid size-12 place-items-center rounded-full">
            <CheckCircle2 className="size-6" />
          </div>
          <CardTitle className="text-2xl">You&apos;re in</CardTitle>
          <CardDescription>
            You&apos;re already part of {church}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="lg" className="w-full" onClick={goDashboard}>
            Go to dashboard
          </Button>
        </CardContent>
      </Shell>
    );
  }

  if (mode === "invalid" || mode === "used" || mode === "expired") {
    const msg =
      mode === "expired"
        ? "This invitation has expired. Ask your church admin to send a new one."
        : mode === "used"
          ? "This invitation has already been used."
          : "We couldn't find this invitation. The link may be incorrect.";
    return (
      <Shell>
        <CardHeader className="text-center">
          <div className="bg-destructive/10 text-destructive mx-auto mb-2 grid size-12 place-items-center rounded-full">
            <XCircle className="size-6" />
          </div>
          <CardTitle className="text-2xl">Invitation unavailable</CardTitle>
          <CardDescription>{msg}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="lg" variant="outline" className="w-full">
            <Link href="/login">Go to login</Link>
          </Button>
        </CardContent>
      </Shell>
    );
  }

  if (mode === "wrongUser") {
    return (
      <Shell>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Wrong account</CardTitle>
          <CardDescription>
            This invitation is for{" "}
            <span className="text-foreground font-semibold">{email}</span>, but
            you&apos;re signed in as{" "}
            <span className="text-foreground font-semibold">{sessionEmail}</span>
            . Sign out and use the invited email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            size="lg"
            className="w-full"
            onClick={doSignOut}
            disabled={pending}
          >
            {pending && <Loader2 className="animate-spin" />}
            Sign out
          </Button>
        </CardContent>
      </Shell>
    );
  }

  // ---- Action states ---------------------------------------------------

  return (
    <Shell>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Join {church}</CardTitle>
        <CardDescription>
          {mode === "accept"
            ? `You're signed in as ${sessionEmail}. Accept to join the team.`
            : mode === "login"
              ? `You already have an account for ${email}. Log in to join.`
              : `Create your account for ${email} to join the team.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mode === "accept" && (
          <Button
            size="lg"
            className="w-full"
            onClick={doAccept}
            disabled={pending}
          >
            {pending && <Loader2 className="animate-spin" />}
            Accept invitation
          </Button>
        )}

        {mode === "signup" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="e.g. Mary Johnson"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Choose a password</Label>
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                minLength={8}
                onKeyDown={(e) => e.key === "Enter" && doSignup()}
              />
            </div>
            <Button
              size="lg"
              className="w-full"
              onClick={doSignup}
              disabled={pending}
            >
              {pending && <Loader2 className="animate-spin" />}
              Join {church}
            </Button>
            <p className="text-muted-foreground text-center text-xs">
              Already have an account?{" "}
              <button
                type="button"
                className="text-primary font-semibold hover:underline"
                onClick={() => setMode("login")}
              >
                Log in instead
              </button>
            </p>
          </>
        )}

        {mode === "login" && (
          <>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={email ?? ""} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password">Password</Label>
              <PasswordInput
                id="login-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Your password"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && doLogin()}
              />
            </div>
            <Button
              size="lg"
              className="w-full"
              onClick={doLogin}
              disabled={pending}
            >
              {pending && <Loader2 className="animate-spin" />}
              Log in &amp; join
            </Button>
            <p className="text-muted-foreground text-center text-xs">
              <Link
                href="/forgot-password"
                className="text-primary font-semibold hover:underline"
              >
                Forgot your password?
              </Link>
            </p>
          </>
        )}
      </CardContent>
    </Shell>
  );
}
