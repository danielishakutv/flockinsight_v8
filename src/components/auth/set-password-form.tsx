"use client";

import { useState, useTransition } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setNewPassword } from "@/app/set-password/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useT } from "@/components/i18n-provider";

export function SetPasswordForm() {
  const t = useT();
  const [pending, start] = useTransition();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      // On success this redirects; only errors return.
      const res = await setNewPassword(password, confirm);
      if (res && !res.ok) toast.error(res.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="new-pw">{t("auth.newPassword")}</Label>
        <PasswordInput
          id="new-pw"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-pw">{t("auth.confirmPassword")}</Label>
        <PasswordInput
          id="confirm-pw"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
        Set new password
      </Button>
    </form>
  );
}
