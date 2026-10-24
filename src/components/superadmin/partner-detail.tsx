"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft,
  BadgeCheck,
  Banknote,
  Building2,
  Copy,
  History,
  KeyRound,
  Landmark,
  Loader2,
  LogOut,
  Mail,
  Pause,
  Play,
  Save,
  Shield,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  savePartnerBankByAdmin,
  savePartnerProfile,
  savePartnerStatus,
  savePartnerVerification,
  sendPartnerDigestNow,
  stopPartnerDigest,
} from "@/app/superadmin/partners/actions";
import { DIGEST_SEGMENT_LABEL, type DigestSegment } from "@/lib/partner-digest-shared";
import {
  resetUserPasswordAction,
  sendResetLink,
  setUserPasswordAction,
  signOutEverywhere,
  updateUser,
} from "@/app/superadmin/users/actions";
import {
  PARTNER_STATUS_EFFECT,
  PARTNER_STATUS_LABEL,
  PARTNER_STATUS_TONE,
  type PartnerStatus,
} from "@/lib/partners-shared";
import { SEVERITY_TONE, type AuditSeverity } from "@/lib/audit-catalog";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PartnerInfo = {
  id: string;
  code: string;
  displayName: string;
  status: PartnerStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  /** When the email about the current status was accepted; behind = untold. */
  statusNotifiedAt: string | null;
  digestOptOutAt: string | null;
  phone: string | null;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  tierOverride: string | null;
  note: string | null;
  createdAt: string;
};

type LoginInfo = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  mustChangePassword: boolean;
  isSuperAdmin: boolean;
  createdAt: string;
  liveSessions: number;
  lastSignIn: string | null;
  seats: { churchId: string; churchName: string; role: string }[];
};

type Wallet = {
  available: number;
  requested: number;
  pending: number;
  paid: number;
  lifetime: number;
};

type PartnerChurch = {
  churchId: string;
  name: string;
  plan: string;
  status: string;
  city: string | null;
  country: string;
  signedUpAt: string;
  payments: number;
  lastPaidAt: string | null;
  earned: number;
};

type Earning = {
  id: string;
  kind: string;
  amount: number;
  currency: string;
  rateBps: number;
  status: string;
  payoutId: string | null;
  churchName: string | null;
  note: string | null;
  createdAt: string;
};

type Payout = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reference: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  requestedAt: string;
  paidAt: string | null;
};

type Digest = {
  id: string;
  manual: boolean;
  segment: string;
  status: string;
  subject: string | null;
  error: string | null;
  attempts: number;
  at: string;
};

type Activity = {
  id: string;
  summary: string;
  severity: AuditSeverity;
  actorName: string | null;
  createdAt: string;
};

const KIND_LABEL: Record<string, string> = {
  first: "First payment",
  second: "Second payment",
  trail: "Monthly share",
  bonus: "Bonus",
  reversal: "Reversal",
};

/** The moves offered from each status, as [target, button label]. */
const MOVES: Record<PartnerStatus, [PartnerStatus, string][]> = {
  pending: [
    ["active", "Approve"],
    ["suspended", "Decline (suspend)"],
  ],
  active: [
    ["paused", "Pause"],
    ["suspended", "Suspend"],
  ],
  paused: [
    ["active", "Resume"],
    ["suspended", "Suspend"],
  ],
  suspended: [
    ["active", "Reinstate"],
    ["paused", "Move to paused"],
  ],
};

const day = (iso: string) => format(parseISO(iso), "d MMM yyyy");
const when = (iso: string) => format(parseISO(iso), "d MMM yyyy, HH:mm");
const money = (n: number, currency = "NGN") => formatMoney(n, currency);

/**
 * Everything superadmin can do to one Partner's account, on one page.
 *
 * Grouped by what each change TOUCHES, because the consequences differ:
 * status decides whether they earn and withdraw; the login is a person's
 * sign-in to everything, possibly a church too; profile, verification and the
 * payout account are this programme's own. Every change that a Partner would
 * want to know about tells them, and every one is in the activity list at the
 * bottom with who made it.
 */
export function PartnerDetail({
  partner,
  login,
  canManageLogin,
  isSelf,
  shareLink,
  tiers,
  tier,
  liveChurches,
  wallet,
  churches,
  earnings,
  payouts,
  digests,
  nextDigestLabel,
  activity,
}: {
  partner: PartnerInfo;
  login: LoginInfo;
  canManageLogin: boolean;
  isSelf: boolean;
  shareLink: string;
  tiers: string[];
  tier: string;
  liveChurches: number;
  wallet: Wallet;
  churches: PartnerChurch[];
  earnings: Earning[];
  payouts: Payout[];
  digests: Digest[];
  nextDigestLabel: string;
  activity: Activity[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // Status dialog
  const [move, setMove] = useState<PartnerStatus | null>(null);
  const [reason, setReason] = useState("");

  // Login
  const [loginName, setLoginName] = useState(login.name);
  const [loginEmail, setLoginEmail] = useState(login.email);
  const [pw, setPw] = useState("");
  const [forceChange, setForceChange] = useState(true);
  const [tempPw, setTempPw] = useState<string | null>(null);

  // Profile
  const [profile, setProfile] = useState({
    displayName: partner.displayName,
    phone: partner.phone ?? "",
    tierOverride: partner.tierOverride ?? "",
    note: partner.note ?? "",
  });

  // Bank
  const [bank, setBank] = useState({
    bankName: partner.bankName ?? "",
    bankAccountNumber: partner.bankAccountNumber ?? "",
    bankAccountName: partner.bankAccountName ?? "",
  });

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    done: string,
    after?: () => void,
  ) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Something went wrong");
      toast.success(done);
      after?.();
      router.refresh();
    });

  function openMove(target: PartnerStatus) {
    setMove(target);
    // Editing the reason of the status they are already in keeps the words.
    setReason(target === partner.status ? (partner.statusReason ?? "") : "");
  }

  function confirmMove() {
    if (!move) return;
    const target = move;
    start(async () => {
      const res = await savePartnerStatus({
        partnerId: partner.id,
        status: target,
        reason: reason.trim() || undefined,
      });
      if (!res.ok) return void toast.error(res.error);
      if (res.emailed === null) toast.success("Reason updated.");
      else if (res.emailed) toast.success(`${PARTNER_STATUS_LABEL[target]}. They've been emailed.`);
      else
        toast.warning(
          `${PARTNER_STATUS_LABEL[target]}. The email didn't go through — it is retried every hour, and you'll get an alert if it still hasn't gone in a day.`,
        );
      setMove(null);
      router.refresh();
    });
  }

  function saveLogin() {
    const emailChanging = loginEmail.trim().toLowerCase() !== login.email.toLowerCase();
    if (
      emailChanging &&
      !confirm(
        `Change the sign-in email to ${loginEmail.trim()}? Both addresses will be told, and ${partner.displayName} must confirm the new one before withdrawing.`,
      )
    )
      return;
    start(async () => {
      const res = await updateUser(login.id, { name: loginName, email: loginEmail });
      if (!res.ok) return void toast.error(res.error);
      const n = res.notices;
      if (!n) toast.success("Saved.");
      else if (n.sent === n.of) toast.success("Sign-in email changed. Both addresses were told.");
      else
        toast.warning(
          n.sent === 0
            ? "Sign-in email changed, but neither address could be emailed — tell them another way."
            : "Sign-in email changed, but only one of the two addresses could be emailed.",
        );
      router.refresh();
    });
  }

  function setPassword() {
    if (pw.length < 8) return void toast.error("Password must be at least 8 characters.");
    run(
      () => setUserPasswordAction(login.id, pw, forceChange),
      "Password set. They were emailed that it changed (not the password itself).",
      () => setPw(""),
    );
  }

  function resetTemp() {
    if (!confirm(`Reset ${login.email} to a temporary password and email it to them?`)) return;
    start(async () => {
      const res = await resetUserPasswordAction(login.id);
      if (!res.ok) return void toast.error(res.error);
      setTempPw(res.tempPassword);
      toast.success(
        res.emailed
          ? "Temporary password emailed."
          : "Temporary password made, but the email failed — give it to them another way.",
      );
      router.refresh();
    });
  }

  function signOutAll() {
    if (!confirm(`Sign ${login.email} out of every device? They'll need to log in again.`)) return;
    start(async () => {
      const res = await signOutEverywhere(login.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        res.ended === 0
          ? "They weren't signed in anywhere."
          : `Signed out of ${res.ended} session${res.ended === 1 ? "" : "s"}.`,
      );
      router.refresh();
    });
  }

  function saveProfile() {
    run(
      () =>
        savePartnerProfile({
          partnerId: partner.id,
          displayName: profile.displayName,
          phone: profile.phone,
          tierOverride: profile.tierOverride,
          note: profile.note,
        }),
      "Partner details saved.",
    );
  }

  function verify(which: "email" | "phone", verified: boolean) {
    const what = which === "email" ? login.email : partner.phone;
    if (
      verified &&
      !confirm(
        `Mark ${what} as verified? Only do this if you've confirmed it yourself — it opens withdrawals.`,
      )
    )
      return;
    run(
      () => savePartnerVerification({ partnerId: partner.id, which, verified }),
      verified ? "Marked verified." : "Verification cleared.",
    );
  }

  function saveBank() {
    if (
      !confirm(
        `Pay ${partner.displayName}'s withdrawals to ${bank.bankName} ${bank.bankAccountNumber}? They will be told by email${partner.phoneVerifiedAt ? " and text" : ""}.`,
      )
    )
      return;
    start(async () => {
      const res = await savePartnerBankByAdmin({ partnerId: partner.id, ...bank });
      if (!res.ok) return void toast.error(res.error);
      if (!res.changed) toast.success("Saved — the same account, so nobody needed telling.");
      else if (res.emailed)
        toast.success(
          `Payout account saved. They've been emailed${res.texted ? " and texted" : ""}.`,
        );
      else
        toast.warning(
          `Payout account saved, but the email could not be sent${res.texted ? " (the text was)" : ""} — tell them another way.`,
        );
      router.refresh();
    });
  }

  function digestNow() {
    start(async () => {
      const res = await sendPartnerDigestNow(partner.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Sent: "${res.subject}"`);
      router.refresh();
    });
  }

  function stopDigest() {
    if (!confirm(`Stop ${partner.displayName}'s progress emails? Only they can turn them back on.`)) return;
    run(() => stopPartnerDigest(partner.id), "Their progress emails are off.");
  }

  function copyLink() {
    navigator.clipboard.writeText(shareLink).then(
      () => toast.success("Link copied"),
      (e: unknown) => {
        console.error("clipboard write failed", e);
        toast.error("Couldn't copy — select the link and copy it by hand.");
      },
    );
  }

  const holding = move === "paused" || move === "suspended";
  const sameStatus = move === partner.status;
  // Declared on the row: the email about the current status was accepted, or not yet.
  const statusTold =
    !partner.statusChangedAt ||
    (!!partner.statusNotifiedAt && partner.statusNotifiedAt >= partner.statusChangedAt);
  const digestEligible =
    !partner.digestOptOutAt && (partner.status === "active" || partner.status === "pending");
  // Your own Partner record is changed by another admin; the server refuses too.
  const locked = isSelf;

  return (
    <div className="max-w-5xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/superadmin/partners">
          <ArrowLeft className="size-4" /> All Partners
        </Link>
      </Button>

      {/* Who */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight">{partner.displayName}</h1>
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-xs font-semibold",
              PARTNER_STATUS_TONE[partner.status],
            )}
          >
            {PARTNER_STATUS_LABEL[partner.status]}
          </span>
          <Badge variant="outline">
            {tier}
            {partner.tierOverride ? " · set by hand" : ""}
          </Badge>
          {login.isSuperAdmin && (
            <Badge className="gap-1">
              <Shield className="size-3" /> Platform admin
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-sm break-words">
          Code <span className="text-foreground font-mono">{partner.code}</span> · {login.email} ·
          Partner since {day(partner.createdAt)}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <code className="bg-muted max-w-full truncate rounded px-2 py-1 text-xs">{shareLink}</code>
          <Button size="sm" variant="outline" onClick={copyLink}>
            <Copy className="size-4" /> Copy link
          </Button>
        </div>
      </div>

      {locked && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          This is your own Partner account. Its status, details, verification and payout account
          have to be changed by another admin.
        </p>
      )}

      {/* Figures */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Figure label="Churches signed" value={String(churches.length)} />
        <Figure label="Live & paying" value={String(liveChurches)} />
        <Figure label="Available" value={money(wallet.available)} />
        <Figure label="Requested" value={money(wallet.requested)} />
        <Figure label="Pending" value={money(wallet.pending)} />
        <Figure label="Paid out" value={money(wallet.paid)} />
      </div>

      {/* Status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="text-primary size-4" /> Account status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <strong>{PARTNER_STATUS_LABEL[partner.status]}</strong>
            {partner.statusChangedAt ? ` since ${day(partner.statusChangedAt)}` : ""}.{" "}
            <span className="text-muted-foreground">{PARTNER_STATUS_EFFECT[partner.status]}</span>
          </p>
          {partner.statusChangedAt && (
            <p
              className={cn(
                "flex items-center gap-1.5 text-xs",
                statusTold ? "text-muted-foreground" : "font-semibold text-amber-700 dark:text-amber-300",
              )}
            >
              <Mail className="size-3.5 shrink-0" />
              {statusTold
                ? `They were emailed about this${partner.statusNotifiedAt ? ` on ${when(partner.statusNotifiedAt)}` : ""}.`
                : "The email telling them hasn't gone through yet — it is retried every hour for three days."}
            </p>
          )}
          {partner.statusReason && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 break-words">
              <span className="font-semibold">Reason they were given:</span> {partner.statusReason}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {MOVES[partner.status].map(([target, label]) => (
              <Button
                key={target}
                size="sm"
                variant={target === "active" ? "default" : target === "suspended" ? "outline" : "secondary"}
                className={cn(target === "suspended" && "text-destructive")}
                onClick={() => openMove(target)}
                disabled={pending || locked}
              >
                {target === "paused" ? (
                  <Pause className="size-4" />
                ) : target === "active" ? (
                  <Play className="size-4" />
                ) : null}
                {label}
              </Button>
            ))}
            {(partner.status === "paused" || partner.status === "suspended") && (
              <Button size="sm" variant="ghost" onClick={() => openMove(partner.status)} disabled={pending || locked}>
                Edit reason
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Login */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="text-primary size-4" /> Sign-in
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              {login.liveSessions > 0
                ? `Signed in on ${login.liveSessions} device${login.liveSessions === 1 ? "" : "s"}`
                : "Not signed in anywhere"}
              {login.lastSignIn ? ` · last sign-in ${when(login.lastSignIn)}` : ""}
              {login.mustChangePassword ? " · must choose a new password at next login" : ""}
            </p>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {login.seats.length > 0 && (
              <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs break-words">
                This login also works in{" "}
                {login.seats.map((s, i) => (
                  <span key={s.churchId}>
                    {i > 0 && ", "}
                    <Link href={`/superadmin/churches/${s.churchId}`} className="font-semibold hover:underline">
                      {s.churchName}
                    </Link>{" "}
                    ({s.role})
                  </span>
                ))}
                . Anything you change here changes their sign-in there too.
              </p>
            )}

            {!canManageLogin ? (
              <p className="text-muted-foreground">
                Changing the sign-in email or password needs the{" "}
                <strong>Users — manage</strong> permission as well as Finance. Ask a full admin, or
                for that permission on your admin role.
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pd-login-name">Name on the account</Label>
                    <Input
                      id="pd-login-name"
                      value={loginName}
                      onChange={(e) => setLoginName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pd-login-email">Sign-in email</Label>
                    <Input
                      id="pd-login-email"
                      type="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">
                  Changing the email tells both the old and new address, and clears their Partner
                  email verification — withdrawals wait until they confirm the new one.
                </p>
                <Button
                  size="sm"
                  onClick={saveLogin}
                  disabled={
                    pending ||
                    (loginName.trim() === login.name && loginEmail.trim() === login.email)
                  }
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Save sign-in
                </Button>

                <div className="space-y-2 border-t pt-4">
                  <Label htmlFor="pd-pw">Set a new password</Label>
                  <div className="flex flex-wrap gap-2">
                    <PasswordInput
                      id="pd-pw"
                      value={pw}
                      onChange={(e) => setPw(e.target.value)}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      className="min-w-[12rem] flex-1"
                    />
                    <Button size="sm" onClick={setPassword} disabled={pending || pw.length < 8}>
                      Set password
                    </Button>
                  </div>
                  <label className="text-muted-foreground flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={forceChange}
                      onChange={(e) => setForceChange(e.target.checked)}
                    />
                    Make them choose their own at next login
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={resetTemp} disabled={pending}>
                    <KeyRound className="size-4" /> Temporary password
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => run(() => sendResetLink(login.id), "Reset link emailed.")}
                    disabled={pending}
                  >
                    <Mail className="size-4" /> Email a reset link
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    onClick={signOutAll}
                    disabled={pending || isSelf}
                    title={isSelf ? "That would sign you out too" : undefined}
                  >
                    <LogOut className="size-4" /> Sign out everywhere
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  A new password stops the next sign-in, not a session that is already open. If
                  someone else may be in the account, set the password and then sign them out
                  everywhere.
                </p>

                {tempPw && (
                  <div className="bg-muted flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
                    <div>
                      <p className="text-muted-foreground text-xs">Temporary password</p>
                      <code className="text-lg font-bold">{tempPw}</code>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigator.clipboard.writeText(tempPw).then(
                          () => toast.success("Copied"),
                          (e: unknown) => {
                            console.error("clipboard write failed", e);
                            toast.error("Couldn't copy — select it and copy by hand.");
                          },
                        )
                      }
                    >
                      <Copy className="size-4" /> Copy
                    </Button>
                  </div>
                )}

                <Link
                  href={`/superadmin/users/${login.id}`}
                  className="text-primary inline-block text-xs font-semibold hover:underline"
                >
                  Open the full account page →
                </Link>
              </>
            )}
          </CardContent>
        </Card>

        {/* Profile */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserRound className="text-primary size-4" /> Partner details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pd-name">Display name</Label>
                <Input
                  id="pd-name"
                  value={profile.displayName}
                  onChange={(e) => setProfile((p) => ({ ...p, displayName: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-phone">Phone</Label>
                <Input
                  id="pd-phone"
                  type="tel"
                  value={profile.phone}
                  onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Tier</Label>
              <Select
                value={profile.tierOverride || "__earned"}
                onValueChange={(v) =>
                  setProfile((p) => ({ ...p, tierOverride: v === "__earned" ? "" : v }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__earned">
                    Earned from live churches{partner.tierOverride ? "" : ` (now ${tier})`}
                  </SelectItem>
                  {tiers.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t} — set by hand
                    </SelectItem>
                  ))}
                  {/* A saved override whose tier was renamed away still shows. */}
                  {partner.tierOverride && !tiers.includes(partner.tierOverride) && (
                    <SelectItem value={partner.tierOverride}>
                      {partner.tierOverride} — no longer on the ladder
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                A tier set by hand decides their commission rate on every payment from now on,
                whatever their churches do.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pd-note">Internal note</Label>
              <Textarea
                id="pd-note"
                rows={3}
                value={profile.note}
                onChange={(e) => setProfile((p) => ({ ...p, note: e.target.value }))}
                placeholder="Only admins see this."
              />
            </div>
            <p className="text-muted-foreground text-xs">
              A new phone number has to be verified again before they can withdraw.
            </p>
            <Button size="sm" onClick={saveProfile} disabled={pending || locked}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save details
            </Button>
          </CardContent>
        </Card>

        {/* Verification */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <BadgeCheck className="text-primary size-4" /> Verification for withdrawals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <VerifyRow
              label="Email"
              value={login.email}
              verifiedAt={partner.emailVerifiedAt}
              busy={pending || locked}
              onVerify={() => verify("email", true)}
              onClear={() => verify("email", false)}
            />
            <VerifyRow
              label="Phone"
              value={partner.phone}
              verifiedAt={partner.phoneVerifiedAt}
              busy={pending || locked}
              onVerify={() => verify("phone", true)}
              onClear={() => verify("phone", false)}
            />
            <p className="text-muted-foreground text-xs">
              Normally they verify these themselves with a code. Mark one verified only when you
              have confirmed it another way — you rang the number, or they wrote in from that inbox.
            </p>
          </CardContent>
        </Card>

        {/* Bank */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="text-primary size-4" /> Payout account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="space-y-1.5">
              <Label htmlFor="pd-bank">Bank</Label>
              <Input
                id="pd-bank"
                value={bank.bankName}
                onChange={(e) => setBank((b) => ({ ...b, bankName: e.target.value }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pd-acct">Account number</Label>
                <Input
                  id="pd-acct"
                  inputMode="numeric"
                  value={bank.bankAccountNumber}
                  onChange={(e) =>
                    setBank((b) => ({ ...b, bankAccountNumber: e.target.value.replace(/\D/g, "") }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-acct-name">Account name</Label>
                <Input
                  id="pd-acct-name"
                  value={bank.bankAccountName}
                  onChange={(e) => setBank((b) => ({ ...b, bankAccountName: e.target.value }))}
                />
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              They are told by email (and text, if their phone is verified). A withdrawal already
              requested keeps the account it was requested to.
            </p>
            <Button
              size="sm"
              onClick={saveBank}
              disabled={
                pending ||
                locked ||
                (bank.bankName === (partner.bankName ?? "") &&
                  bank.bankAccountNumber === (partner.bankAccountNumber ?? "") &&
                  bank.bankAccountName === (partner.bankAccountName ?? ""))
              }
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save payout account
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Progress emails */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="text-primary size-4" /> Progress emails
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            {partner.digestOptOutAt
              ? `They turned these off on ${day(partner.digestOptOutAt)}. Only they can turn them back on, from their Partner page.`
              : digestEligible
                ? `Mondays and Thursdays from 9:00 Lagos. Next: ${nextDigestLabel}.`
                : `Not sent while they are ${partner.status} — they get the email about their status instead.`}
          </p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={digestNow} disabled={pending || !digestEligible}>
              <Mail className="size-4" /> Send their update now
            </Button>
            {!partner.digestOptOutAt && (
              <Button size="sm" variant="ghost" onClick={stopDigest} disabled={pending}>
                Stop their updates
              </Button>
            )}
          </div>
          {digests.length === 0 ? (
            <p className="text-muted-foreground text-xs">None sent yet.</p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {digests.map((d) => (
                <li key={d.id} className="px-3 py-2">
                  <p className="break-words">
                    <span
                      className={cn(
                        "mr-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                        d.status === "sent"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : d.status === "failed"
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {d.status}
                    </span>
                    {d.subject ?? "—"}
                  </p>
                  <p className="text-muted-foreground text-xs break-words">
                    {when(d.at)} · {DIGEST_SEGMENT_LABEL[d.segment as DigestSegment] ?? d.segment}
                    {d.manual ? " · sent by hand" : ""}
                    {d.status === "failed" && d.error ? ` · ${d.error} (try ${d.attempts})` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Churches */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="text-primary size-4" /> Churches they brought ({churches.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {churches.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">None yet.</p>
          ) : (
            <ScrollableTable stickyFirstColumn hint="Scroll for more" label="Churches">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="text-muted-foreground border-b text-left text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Church</th>
                    <th className="px-3 py-2 font-semibold">Plan</th>
                    <th className="px-3 py-2 text-right font-semibold">Payments</th>
                    <th className="px-3 py-2 font-semibold">Last paid</th>
                    <th className="px-3 py-2 text-right font-semibold">Earned them</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {churches.map((c) => (
                    <tr key={c.churchId}>
                      <td className="px-3 py-2">
                        <Link
                          href={`/superadmin/churches/${c.churchId}`}
                          className="text-primary font-medium hover:underline"
                        >
                          {c.name}
                        </Link>
                        <p className="text-muted-foreground text-xs">
                          Signed {day(c.signedUpAt)}
                          {c.status !== "active" ? ` · ${c.status}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2 capitalize">{c.plan}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.payments}</td>
                      <td className="px-3 py-2">{c.lastPaidAt ? day(c.lastPaidAt) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(c.earned)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
          )}
        </CardContent>
      </Card>

      {/* Withdrawals */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Banknote className="text-primary size-4" /> Withdrawals ({payouts.length})
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            Open requests are approved and paid from the queue on the{" "}
            <Link href="/superadmin/partners" className="text-primary hover:underline">
              Partners page
            </Link>
            .
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {payouts.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">None yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {payouts.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {money(x.amount, x.currency)}{" "}
                      <span className="text-muted-foreground text-xs font-normal capitalize">
                        {x.status}
                      </span>
                    </p>
                    <p className="text-muted-foreground text-xs break-words">
                      Requested {when(x.requestedAt)} · {x.bankName} {x.bankAccountNumber}
                      {x.paidAt ? ` · paid ${day(x.paidAt)}` : ""}
                      {x.reference ? ` · ref ${x.reference}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Earnings */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Earnings ledger (latest {earnings.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {earnings.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">Nothing earned yet.</p>
          ) : (
            <ScrollableTable stickyFirstColumn hint="Scroll for more" label="Earnings">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="text-muted-foreground border-b text-left text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Church</th>
                    <th className="px-3 py-2 font-semibold">For</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {earnings.map((e) => (
                    <tr key={e.id}>
                      <td className="px-3 py-2 whitespace-nowrap">{day(e.createdAt)}</td>
                      <td className="px-3 py-2">{e.churchName ?? "—"}</td>
                      <td className="px-3 py-2">
                        {KIND_LABEL[e.kind] ?? e.kind}
                        <span className="text-muted-foreground"> · {e.rateBps / 100}%</span>
                        {e.note && <p className="text-muted-foreground text-xs">{e.note}</p>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(e.amount, e.currency)}</td>
                      <td className="px-3 py-2 text-xs">
                        {/* A claimed row stays "available" until its payout is paid. */}
                        {e.status === "available" && e.payoutId ? "in a request" : e.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
          )}
        </CardContent>
      </Card>

      {/* Activity */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="text-primary size-4" /> Account activity
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {activity.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start gap-2 px-4 py-2.5">
                  <span
                    className={cn("mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", SEVERITY_TONE[a.severity])}
                  >
                    {a.severity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words">{a.summary}</p>
                    <p className="text-muted-foreground text-xs">
                      {a.actorName ?? "System"} · {when(a.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Change status */}
      <Dialog open={!!move} onOpenChange={(o) => !o && setMove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {move && sameStatus
                ? `Edit the reason ${partner.displayName} sees`
                : move
                  ? `${MOVES[partner.status].find(([t]) => t === move)?.[1] ?? PARTNER_STATUS_LABEL[move]} ${partner.displayName}?`
                  : ""}
            </DialogTitle>
            {move && <DialogDescription>{PARTNER_STATUS_EFFECT[move]}</DialogDescription>}
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {holding && (
              <div className="space-y-1.5">
                <Label htmlFor="pd-reason">Reason (they will see this)</Label>
                <Textarea
                  id="pd-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. We need to confirm the bank account on file before paying out."
                />
              </div>
            )}
            {!sameStatus && (
              <p className="text-muted-foreground flex items-center gap-2 text-xs">
                <Mail className="size-3.5 shrink-0" />
                {login.email} will be emailed about this{holding ? ", with the reason" : ""}.
              </p>
            )}
            {move === "suspended" && (
              <p className="text-destructive text-xs">
                While suspended, commission on their churches&rsquo; payments is not recorded. If you
                only need to hold their money, pause instead.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMove(null)}>
              Cancel
            </Button>
            <Button
              onClick={confirmMove}
              disabled={pending}
              variant={move === "suspended" ? "destructive" : "default"}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {sameStatus ? "Save reason" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-xl border p-3">
      <p className="text-muted-foreground text-xs font-semibold uppercase">{label}</p>
      <p className="mt-1 truncate text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

function VerifyRow({
  label,
  value,
  verifiedAt,
  busy,
  onVerify,
  onClear,
}: {
  label: string;
  value: string | null;
  verifiedAt: string | null;
  busy: boolean;
  onVerify: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
      <div className="min-w-0">
        <p className="font-semibold">{label}</p>
        <p className="text-muted-foreground text-xs break-words">
          {value ?? "None on file"} ·{" "}
          {verifiedAt ? (
            <span className="text-primary">verified {day(verifiedAt)}</span>
          ) : (
            "not verified"
          )}
        </p>
      </div>
      {verifiedAt ? (
        <Button size="sm" variant="ghost" onClick={onClear} disabled={busy}>
          Clear
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={onVerify} disabled={busy || !value}>
          Mark verified
        </Button>
      )}
    </div>
  );
}
