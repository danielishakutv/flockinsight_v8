"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { adminOnboardChurch } from "@/app/superadmin/onboard-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Set a church up from this side, ready to log into.
 *
 * For signing somebody up in a meeting: they should be able to log in before
 * you leave the room, not after they find a verification email. Everything the
 * normal flow waits for is asserted here on the admin's authority, and the
 * audit log records that it was asserted rather than checked.
 */
export function OnboardChurch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{
    churchId: string;
    tempPassword: string | null;
    email: string;
  } | null>(null);

  const [churchName, setChurchName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [plan, setPlan] = useState("starter");
  const [password, setPassword] = useState("");
  const [trialSundays, setTrialSundays] = useState("7");
  const [markVerified, setMarkVerified] = useState(true);

  function reset() {
    setChurchName("");
    setOwnerName("");
    setOwnerEmail("");
    setContactPhone("");
    setPlan("starter");
    setPassword("");
    setTrialSundays("7");
    setMarkVerified(true);
    setDone(null);
  }

  function submit() {
    start(async () => {
      const res = await adminOnboardChurch({
        churchName,
        ownerName,
        ownerEmail,
        contactPhone: contactPhone || null,
        plan: plan as "starter",
        password: password || null,
        trialSundays: Number(trialSundays) || 0,
        markVerified,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setDone({
        churchId: res.churchId,
        tempPassword: res.tempPassword,
        email: ownerEmail.trim().toLowerCase(),
      });
      router.refresh();
    });
  }

  return (
    <>
      <Button onClick={() => { reset(); setOpen(true); }}>
        <Plus className="size-4" /> Onboard a church
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {done ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Check className="text-primary size-5" /> {churchName} is ready
                </DialogTitle>
                <DialogDescription>
                  They can log in now — no verification needed.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 text-sm">
                <Field label="Email" value={done.email} />
                {done.tempPassword ? (
                  <>
                    <Field label="Password" value={done.tempPassword} mono />
                    {/*
                      Shown once and never emailed: a password sitting in an
                      inbox outlives the call it was meant for.
                    */}
                    <p className="text-muted-foreground text-xs">
                      Read this out now — it is not shown again and was not
                      emailed. They&apos;ll choose their own at first login.
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    They log in with the password you chose, then pick their own.
                  </p>
                )}
              </div>

              <DialogFooter className="gap-2 sm:justify-between">
                <Button variant="outline" asChild>
                  <Link href={`/superadmin/churches/${done.churchId}`}>
                    <ExternalLink className="size-4" /> Open the church
                  </Link>
                </Button>
                <Button onClick={() => { setOpen(false); reset(); }}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Onboard a church</DialogTitle>
                <DialogDescription>
                  Creates the church and its owner account, ready to use.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="ob-church">Church name</Label>
                  <Input
                    id="ob-church"
                    value={churchName}
                    onChange={(e) => setChurchName(e.target.value)}
                    placeholder="Grace Chapel"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ob-owner">Owner&apos;s name</Label>
                  <Input
                    id="ob-owner"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="Pastor Daniel"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ob-email">Owner&apos;s email</Label>
                  <Input
                    id="ob-email"
                    type="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    placeholder="pastor@church.org"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ob-phone">Church phone (optional)</Label>
                  <Input
                    id="ob-phone"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="08012345678"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ob-plan">Plan</Label>
                  <Select value={plan} onValueChange={setPlan}>
                    <SelectTrigger id="ob-plan">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="growth">Growth</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ob-trial">Free Sundays</Label>
                  <Input
                    id="ob-trial"
                    type="number"
                    min={0}
                    max={52}
                    value={trialSundays}
                    onChange={(e) => setTrialSundays(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ob-pw">Password (optional)</Label>
                  <Input
                    id="ob-pw"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Leave blank to generate"
                    autoComplete="off"
                  />
                </div>
              </div>

              <label className="flex items-start gap-2.5 rounded-xl border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={markVerified}
                  onChange={(e) => setMarkVerified(e.target.checked)}
                  className="mt-0.5 size-4"
                />
                <span>
                  <span className="font-semibold">Skip verification</span>
                  <span className="text-muted-foreground block text-xs">
                    Marks the login and the church&apos;s contact details as
                    verified, so they can start immediately. Only tick this
                    when you have checked who they are yourself — it is
                    recorded against your name.
                  </span>
                </span>
              </label>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={submit}
                  disabled={
                    pending ||
                    !churchName.trim() ||
                    !ownerName.trim() ||
                    !ownerEmail.trim()
                  }
                >
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  Create church
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2">
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className={`truncate font-semibold ${mono ? "font-mono" : ""}`}>
          {value}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={() => {
          navigator.clipboard?.writeText(value);
          toast.success(`${label} copied`);
        }}
      >
        <Copy className="size-4" />
      </Button>
    </div>
  );
}
