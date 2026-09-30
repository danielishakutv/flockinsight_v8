"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
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
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useT } from "@/components/i18n-provider";

function ResetForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <Card className="shadow-lg">
        <CardContent className="py-10 text-center">
          <p className="text-lg font-semibold">{t("common.invalidOrExpiredLink")}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Please request a new password reset.
          </p>
          <Button asChild className="mt-4">
            <Link href="/forgot-password">{t("common.requestNewLink")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get("password"));
    const confirm = String(form.get("confirm"));
    if (newPassword !== confirm) {
      toast.error(t("common.passwordsDonTMatch"));
      return;
    }
    setLoading(true);
    const { error } = await authClient.resetPassword({
      newPassword,
      token: token!,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message || "Could not reset password.");
      return;
    }
    toast.success(t("common.passwordUpdatedPleaseLogIn"));
    router.push("/login");
  }

  return (
    <Card className="shadow-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">{t("common.setANewPassword")}</CardTitle>
        <CardDescription>{t("common.chooseAStrongPasswordYou")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">{t("common.newPassword")}</Label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              minLength={8}
              placeholder={t("common.atLeast8Characters")}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">{t("common.confirmPassword")}</Label>
            <PasswordInput
              id="confirm"
              name="confirm"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
