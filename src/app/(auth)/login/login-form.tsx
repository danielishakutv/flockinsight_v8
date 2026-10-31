"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { signIn, authClient } from "@/lib/auth-client";
import { landingPath } from "@/app/select-church/actions";
import { safeRedirectPath } from "@/lib/safe-redirect";
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
import { useT } from "@/components/i18n-provider";

/** The demo account's login, when the server has been told one. */
export type DemoLogin = { email: string; password: string };

export function LoginForm({ demo }: { demo: DemoLogin | null }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  /*
   * An explicit ?redirect= always wins: somebody following an invite link is
   * going where the link said. Without one, where to land is the server's
   * question to answer — see landingPath().
   *
   * Only a path on this site counts (safeRedirectPath). A raw value let a link
   * like /login?redirect=https://lookalike.example send someone off-site the
   * moment they had signed in on the real domain.
   */
  const explicitRedirect = safeRedirectPath(params.get("redirect"));
  /*
   * Sent here from a Partner page. Same login, same form — one account can be
   * a Partner and run a church — but the words and the "new here" door should
   * match what the person came for, not offer a pastor's sign-up to an agent.
   */
  const forPartner =
    explicitRedirect === "/partner" ||
    (explicitRedirect?.startsWith("/partner/") ?? false) ||
    (explicitRedirect?.startsWith("/partner?") ?? false);
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
        toast.error(t("common.pleaseVerifyYourEmailBefore"));
        return;
      }
      toast.error(error.message || "Could not sign in. Check your details.");
      return;
    }
    toast.success(t("common.welcomeBack"));
    /*
     * Asked, not assumed. Somebody in two churches is sent to the chooser,
     * somebody with none to onboarding, and a platform operator with no church
     * to /superadmin — all facts only the server holds. A failure here is not
     * worth blocking a successful sign-in, so the dashboard remains the
     * fallback and the shell will redirect from there if it has to.
     */
    const target =
      explicitRedirect ?? (await landingPath().catch(() => "/dashboard"));
    router.push(target);
    router.refresh();
  }

  async function resendVerification() {
    if (!unverifiedEmail) return;
    setResending(true);
    const { error } = await authClient.sendVerificationEmail({
      email: unverifiedEmail,
      callbackURL: explicitRedirect ?? "/dashboard",
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
        <CardTitle className="text-2xl">{t("common.welcomeBack")}</CardTitle>
        <CardDescription>
          {forPartner
            ? t("auth.logInForPartner")
            : t("common.logInToYourFlockinsight")}
        </CardDescription>
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
            <Label htmlFor="email">{t("common.email")}</Label>
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
              <Label htmlFor="password">{t("common.password")}</Label>
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

        {/*
          Two doors, because there are two kinds of new account: a church
          (which creates the church) and a Partner (which creates no church).
          Staff never sign up here — they are invited by their church, and the
          invitation carries them to their own sign-up.
        */}
        {forPartner ? (
          <p className="text-muted-foreground mt-6 text-center text-sm">
            {t("auth.noPartnerAccount")}{" "}
            <Link
              href="/partner/join"
              className="text-primary font-semibold hover:underline"
            >
              {t("auth.createPartnerAccount")}
            </Link>
          </p>
        ) : (
          <div className="text-muted-foreground mt-6 space-y-1.5 text-center text-sm">
            <p>
              New here?{" "}
              <Link
                href="/signup"
                className="text-primary font-semibold hover:underline"
              >
                Create your account
              </Link>
            </p>
            <p className="text-xs">
              {t("auth.bringingChurches")}{" "}
              <Link
                href="/partner/join"
                className="text-primary font-semibold hover:underline"
              >
                {t("auth.becomeAPartner")}
              </Link>
            </p>
          </div>
        )}

        {/*
          Only when the server knows a real one (DEMO_LOGIN_EMAIL and
          DEMO_LOGIN_PASSWORD). The pair used to be typed in here — the seed
          script's local account — so every visitor to the live site was handed
          a login that does not exist there, and the first thing a curious
          pastor saw was "Invalid email or password".
        */}
        {!forPartner && demo && (
          <div className="bg-muted/50 mt-6 rounded-lg p-3 text-center text-xs">
            <span className="text-muted-foreground">{t("common.demoLogin")}</span>{" "}
            <span className="font-mono font-medium break-all">
              {demo.email} / {demo.password}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
