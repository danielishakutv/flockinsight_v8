"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock, FlaskConical, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import {
  requestDemoCode,
  restartDemo,
  startDemo,
  verifyDemoCode,
} from "@/app/(app)/demo-actions";
import { DEMO_GRACE_MINUTES } from "@/lib/demo-shared";
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
import { Wordmark } from "@/components/brand";
import { useT } from "@/components/i18n-provider";

/**
 * The door to the demonstration church.
 *
 * It replaces the whole app rather than sitting on top of it, in the one case
 * where that is right: until somebody has said who they are, there is nothing
 * for them to be looking at.
 *
 * Written to be worth filling in. It says what the demo is, that the data is
 * fake, that it is rebuilt every two hours, and that nothing they type is used
 * to sign them up for anything — because a form in front of a product tour
 * either earns its keep in the first two sentences or loses the visitor.
 */
export function DemoGate({
  churchName,
  mode,
  email,
  otpSent = false,
}: {
  churchName: string;
  /** "ask" for a new visitor, "verify" when the fifteen minutes are up. */
  mode: "ask" | "verify";
  email?: string;
  otpSent?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [mail, setMail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(otpSent);

  function begin(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await startDemo({
        name: name.trim() || undefined,
        email: mail.trim(),
        phone: phone.trim(),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  function askForCode() {
    start(async () => {
      const res = await requestDemoCode();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSent(true);
      toast.success(`Code sent to ${res.masked}.`);
    });
  }

  function confirm(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await verifyDemoCode(code);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("You're in. Explore as long as you like.");
      router.refresh();
    });
  }

  function overAgain() {
    start(async () => {
      await restartDemo();
      router.refresh();
    });
  }

  return (
    <div className="bg-muted/30 grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <span className="bg-primary/10 text-primary mx-auto grid size-14 place-items-center rounded-2xl">
            <FlaskConical className="size-7" />
          </span>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight">
            {mode === "ask" ? `Welcome to the ${churchName} demo` : "Still there?"}
          </h1>
        </div>

        {mode === "ask" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("demo.whosLooking")}</CardTitle>
              <CardDescription>
                This is a real FlockInsight workspace with made-up data in every
                module — members, attendance, giving, finance, classes, forms.
                Change anything you like: it is wiped and rebuilt every two
                hours. We ask for your details so we know who tried it, and so
                we can help if you get stuck.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={begin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="d-email">{t("demo.yourEmail")}</Label>
                  <Input
                    id="d-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={mail}
                    onChange={(e) => setMail(e.target.value)}
                    placeholder={t("demo.emailPlaceholder")}
                    required
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="d-phone">{t("demo.yourPhone")}</Label>
                  <Input
                    id="d-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder={t("demo.phonePlaceholder")}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="d-name">
                    {t("demo.nameOrChurch")}{" "}
                    <span className="text-muted-foreground font-normal">
                      {t("demo.optional")}
                    </span>
                  </Label>
                  <Input
                    id="d-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("demo.namePlaceholder")}
                  />
                </div>
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={pending || !mail.trim() || !phone.trim()}
                >
                  {pending && <Loader2 className="animate-spin" />}
                  {t("demo.startExploring")}
                </Button>
                {/*
                  Said plainly, because it is the thing somebody is weighing up
                  while they decide whether to type a real address.
                */}
                <p className="text-muted-foreground text-xs leading-relaxed">
                  You get {DEMO_GRACE_MINUTES} minutes straight away. After
                  that we&apos;ll ask you to confirm your email with a code, so
                  we know the address is real. No card, no account, and nothing
                  is created for your own church.
                </p>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="size-4" /> Your {DEMO_GRACE_MINUTES} minutes are up
              </CardTitle>
              <CardDescription>
                Confirm {email ? <strong>{email}</strong> : "your email address"}{" "}
                with a code and carry on for as long as you like. Nothing you
                have done in the demo is lost — it is all still here.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!sent ? (
                <Button
                  onClick={askForCode}
                  size="lg"
                  className="w-full"
                  disabled={pending}
                >
                  {pending ? <Loader2 className="animate-spin" /> : <MailCheck />}
                  {t("demo.emailMeACode")}
                </Button>
              ) : (
                <form onSubmit={confirm} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="d-code">{t("demo.enterCode")}</Label>
                    <Input
                      id="d-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="000000"
                      className="max-w-[12rem] text-center text-2xl font-bold tracking-[0.4em]"
                      autoFocus
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={pending || code.length !== 6}>
                      {pending && <Loader2 className="animate-spin" />}
                      {t("demo.carryOn")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={askForCode}
                      disabled={pending}
                    >
                      {t("demo.sendAnother")}
                    </Button>
                  </div>
                </form>
              )}

              <div className="border-t pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={overAgain}
                  disabled={pending}
                >
                  {t("demo.differentEmail")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-muted-foreground text-center text-xs">
          Want your own church on FlockInsight?{" "}
          <Link href="/signup" className="font-semibold underline">
            Start free
          </Link>
          .
        </p>
        <div className="text-center">
          <Wordmark
            className="justify-center text-sm opacity-60"
            logoClassName="size-5"
          />
        </div>
      </div>
    </div>
  );
}
