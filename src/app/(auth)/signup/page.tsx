"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { createChurchAccount } from "./actions";
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

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirect") || "";
  // Invitees land here with ?redirect=/accept-invitation/<id>. They should
  // create a personal account and join an existing church — NOT make a new one.
  const inviteMode = redirectTo.startsWith("/accept-invitation");

  const [loading, setLoading] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name")).trim();
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));

    setLoading(true);
    try {
      if (inviteMode) {
        // Create just the user account (no church), then return to the
        // invitation page to accept. After email verification (if on), the
        // callback brings them back to the same accept page.
        const { data, error } = await authClient.signUp.email({
          name,
          email,
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
          setVerifyEmail(email);
        }
        return;
      }

      // Normal sign-up: create the user AND their church in one server step.
      const churchName = String(form.get("churchName")).trim();
      const result = await createChurchAccount({
        churchName,
        name,
        email,
        password,
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
        setVerifyEmail(email);
      }
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
          <CardTitle className="text-2xl">Check your inbox</CardTitle>
          <CardDescription>
            {inviteMode ? "Your account is ready." : "Your church account is ready."}{" "}
            We sent a verification link to{" "}
            <span className="text-foreground font-semibold">{verifyEmail}</span>.
            Confirm your email
            {inviteMode
              ? " to finish joining the church."
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

  return (
    <Card className="shadow-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">
          {inviteMode ? "Create your account" : "Create your church account"}
        </CardTitle>
        <CardDescription>
          {inviteMode
            ? "Set up your account to join the church you were invited to."
            : "Free 30-day trial · No credit card required"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {!inviteMode && (
            <div className="space-y-2">
              <Label htmlFor="churchName">Church name</Label>
              <Input
                id="churchName"
                name="churchName"
                placeholder="Grace Chapel"
                required
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              placeholder="Pastor John Adeyemi"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@church.org"
              required
            />
            {inviteMode && (
              <p className="text-muted-foreground text-xs">
                Use the same email address your invitation was sent to.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              minLength={8}
              required
            />
          </div>
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
