"use client";

import { useState, useTransition } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { changeMyPassword } from "@/app/(app)/profile/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useT } from "@/components/i18n-provider";

/**
 * Changing your own password, which requires the current one.
 *
 * Asking for a password somebody already knows looks like friction for its own
 * sake. It is the difference between a borrowed phone being a nuisance and
 * being a permanent account takeover.
 */
export function ChangePassword() {
  const t = useT();
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await changeMyPassword({ current, next, confirm });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("profile.passwordChanged"));
      setCurrent("");
      setNext("");
      setConfirm("");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("profile.passwordTitle")}</CardTitle>
        <CardDescription>{t("profile.passwordHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pw-current">{t("profile.currentPassword")}</Label>
            <PasswordInput
              id="pw-current"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pw-new">{t("profile.newPassword")}</Label>
              <PasswordInput
                id="pw-new"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw-confirm">{t("profile.repeatPassword")}</Label>
              <PasswordInput
                id="pw-confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={pending || !current || next.length < 8 || !confirm}
          >
            {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
            {t("profile.changePassword")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
