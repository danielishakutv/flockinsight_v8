"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { signIn, authClient } from "@/lib/auth-client";
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

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirect") || "/dashboard";
  const [loading, setLoading] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));

    setLoading(true);
    setUnverifiedEmail(null);
    const { error } = await signIn.email({ email, password });
    setLoading(false);

    if (error) {
      // Email not verified → offer to resend the verification link, since the
      // original email can fail to deliver (e.g. provider/domain limits).
      if (error.status === 403 || error.code === "EMAIL_NOT_VERIFIED") {
        setUnverifiedEmail(email);
        toast.error("Please verify your email before logging in.");
        return;
      }
      toast.error(error.message || "Could not sign in. Check your details.");
      return;
    }
    toast.success("Welcome back!");
    router.push(redirectTo);
    router.refresh();
  }

  async function resendVerification() {
    if (!unverifiedEmail) return;
    setResending(true);
    const { error } = await authClient.sendVerificationEmail({
      email: unverifiedEmail,
      callbackURL: redirectTo,
    });
    setResending(false);
    if (error) {
      toast.error(error.message || "Could not send the email. Try again shortly.");
      return;
    }
    toast.success(`Verification email sent to ${unverifiedEmail}.`);
  }

  return (
    <Card className="shadow-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome back</CardTitle>
        <CardDescription>Log in to your FlockInsight dashboard</CardDescription>
      </CardHeader>
      <CardContent>
        {unverifiedEmail && (
          <div className="border-primary/30 bg-primary/5 mb-4 rounded-lg border p-3 text-sm">
            <p className="text-muted-foreground">
              Your email isn&apos;t verified yet. Didn&apos;t get the link?
            </p>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 font-semibold"
              onClick={resendVerification}
              disabled={resending}
            >
              {resending && <Loader2 className="animate-spin" />}
              Resend verification email
            </Button>
          </div>
        )}
        <form onSubmit={onSubmit} className="space-y-4">
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
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-primary text-sm font-medium hover:underline"
              >
                Forgot?
              </Link>
            </div>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••"
              required
            />
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={loading}
          >
            {loading && <Loader2 className="animate-spin" />}
            Log in
          </Button>
        </form>

        <p className="text-muted-foreground mt-6 text-center text-sm">
          New here?{" "}
          <Link
            href="/signup"
            className="text-primary font-semibold hover:underline"
          >
            Create your church account
          </Link>
        </p>

        <div className="bg-muted/50 mt-6 rounded-lg p-3 text-center text-xs">
          <span className="text-muted-foreground">Demo login: </span>
          <span className="font-mono font-medium">
            demo@flockinsight.app / demo1234
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
