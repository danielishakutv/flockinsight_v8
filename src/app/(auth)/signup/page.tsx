"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
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

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const churchName = String(form.get("churchName")).trim();
    const name = String(form.get("name")).trim();
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));

    setLoading(true);
    try {
      // One server-side step: create the user AND their church (see actions.ts).
      // This works even when email verification is required, where sign-up
      // returns no session and the old client-side church creation 401'd.
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
        // Verification disabled → user is signed in, go straight to the app.
        toast.success(`Welcome to FlockInsight, ${name.split(" ")[0]}!`);
        router.push("/dashboard");
        router.refresh();
      } else {
        // Verification required → account + church created; user must verify
        // their email before they can log in.
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
            Your church account is ready. We sent a verification link to{" "}
            <span className="text-foreground font-semibold">{verifyEmail}</span>
            . Confirm your email, then log in to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="lg" className="w-full">
            <Link href="/login">Go to login</Link>
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
        <CardTitle className="text-2xl">Create your church account</CardTitle>
        <CardDescription>
          Free 30-day trial · No credit card required
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="churchName">Church name</Label>
            <Input
              id="churchName"
              name="churchName"
              placeholder="Grace Chapel"
              required
            />
          </div>
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
            Create free account
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
            href="/login"
            className="text-primary font-semibold hover:underline"
          >
            Log in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
