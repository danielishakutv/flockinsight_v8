"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
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

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email"));
    setLoading(true);
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    setLoading(false);
    if (error) {
      toast.error(error.message || "Could not send reset email.");
      return;
    }
    setSent(true);
  }

  return (
    <Card className="shadow-lg">
      {sent ? (
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="bg-primary/10 text-primary grid size-14 place-items-center rounded-2xl">
            <MailCheck className="size-7" />
          </div>
          <div>
            <p className="text-lg font-semibold">Check your email</p>
            <p className="text-muted-foreground text-sm">
              If an account exists, we&apos;ve sent a password reset link.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/login">Back to login</Link>
          </Button>
        </CardContent>
      ) : (
        <>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Forgot password?</CardTitle>
            <CardDescription>
              Enter your email and we&apos;ll send a reset link.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={loading}
              >
                {loading && <Loader2 className="animate-spin" />}
                Send reset link
              </Button>
            </form>
            <p className="text-muted-foreground mt-6 text-center text-sm">
              <Link href="/login" className="text-primary font-semibold hover:underline">
                Back to login
              </Link>
            </p>
          </CardContent>
        </>
      )}
    </Card>
  );
}
