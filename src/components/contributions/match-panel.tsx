"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Loader2,
  Mail,
  Phone,
  UserCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  acceptMatch,
  addToRegister,
  dismissMatch,
  restoreMatch,
} from "@/app/(app)/contributions/actions";
import type { MatchCandidate, UnmatchedPerson } from "@/lib/contribution-merge";
import { MATCH_REASON_LABEL, splitName } from "@/lib/contributions-shared";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/contributions/pieces";
import { useT } from "@/components/i18n-provider";

/**
 * Turning typed-in names into member records.
 *
 * One card per PERSON, not per row. The same woman turns up in the choir levy,
 * the harvest collection and last year's gift; asking three times is how a
 * screen like this gets abandoned, so one decision links her everywhere and the
 * card says which collections it covers.
 *
 * Nothing is ever linked automatically from here, even on an exact email match.
 * A wrong link moves one person's payments onto another person's record, which
 * is the only genuinely destructive thing this module can do — so the suggestion
 * is confident, the button is one tap, and the tap is a human's.
 */
export function MatchPanel({
  people,
  dismissed,
  currency,
  canAddMembers,
}: {
  people: UnmatchedPerson[];
  dismissed: { id: string; name: string; potTitle: string; potId: string }[];
  currency: string;
  canAddMembers: boolean;
}) {
  const t = useT();
  const [showDismissed, setShowDismissed] = useState(false);

  if (people.length === 0 && dismissed.length === 0) {
    return (
      <div className="bg-card rounded-2xl border p-8 text-center">
        <span className="bg-success/15 text-success mx-auto grid size-12 place-items-center rounded-2xl">
          <UserCheck className="size-6" aria-hidden />
        </span>
        <p className="mt-3 font-bold">{t("contributions.matchNone")}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("contributions.matchEmptyHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {people.map((person) => (
        <PersonCard
          key={person.key}
          person={person}
          currency={currency}
          canAddMembers={canAddMembers}
        />
      ))}

      {people.length === 0 && (
        <div className="bg-card rounded-2xl border p-6 text-center">
          <p className="font-semibold">{t("contributions.matchNone")}</p>
        </div>
      )}

      {dismissed.length > 0 && (
        <div className="bg-card rounded-2xl border p-4">
          <button
            type="button"
            onClick={() => setShowDismissed((s) => !s)}
            aria-expanded={showDismissed}
            className="text-primary flex min-h-11 items-center text-sm font-semibold hover:underline"
          >
            {t("contributions.matchDismissedList")} ({dismissed.length})
          </button>
          {showDismissed && (
            <ul className="mt-3 divide-y">
              {dismissed.map((d) => (
                <DismissedRow key={d.id} row={d} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function PersonCard({
  person,
  currency,
  canAddMembers,
}: {
  person: UnmatchedPerson;
  currency: string;
  canAddMembers: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);

  function link(candidate: MatchCandidate) {
    start(async () => {
      const res = await acceptMatch({
        contributorIds: person.contributorIds,
        memberId: candidate.memberId,
      });
      if (res.ok) {
        toast.success(
          `Linked to ${candidate.name}${res.folded ? ` and merged ${res.folded} duplicate${res.folded === 1 ? "" : "s"}` : ""}`,
        );
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function setAside() {
    start(async () => {
      const res = await dismissMatch(person.contributorIds);
      if (res.ok) {
        toast.success(t("contributions.setAside"));
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="bg-card rounded-2xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold">{person.name}</p>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {[
              person.phone,
              person.email,
              person.totalPaid > 0
                ? t("contributions.givenSoFar", {
                    amount: formatMoney(person.totalPaid, currency),
                  })
                : t("contributions.nothingRecordedYet"),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            <Users className="mr-1 inline size-3" aria-hidden />
            {person.pots.length === 1 ? (
              <Link
                href={`/contributions/${person.pots[0].id}`}
                className="hover:underline"
              >
                {person.pots[0].title}
              </Link>
            ) : (
              <>
                {t("contributions.inCollections", { count: person.pots.length })}{" "}
                {person.pots.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && ", "}
                    <Link href={`/contributions/${p.id}`} className="hover:underline">
                      {p.title}
                    </Link>
                  </span>
                ))}
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {canAddMembers && (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <UserPlus className="size-4" aria-hidden />{" "}
              {t("contributions.matchAddToRegister")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={setAside}
            disabled={pending}
            title={t("contributions.stopSuggesting")}
          >
            <X className="size-4" aria-hidden /> {t("contributions.matchNotThem")}
          </Button>
        </div>
      </div>

      {person.candidates.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {person.candidates.map((c) => (
            <li
              key={c.memberId}
              className={cn(
                "flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3",
                c.best === "name" ? "border-warning/40 bg-warning/5" : "bg-muted/30",
              )}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{c.name}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {c.reasons.map((r) => (
                    <Badge
                      key={r}
                      variant={r === "name" ? "warning" : "success"}
                      className="gap-1 font-medium"
                    >
                      {r === "email" ? (
                        <Mail aria-hidden />
                      ) : r === "phone" ? (
                        <Phone aria-hidden />
                      ) : (
                        <Users aria-hidden />
                      )}
                      {MATCH_REASON_LABEL[r]}
                    </Badge>
                  ))}
                </div>
                {c.best === "name" && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t("contributions.nameOnlyWarning")}
                  </p>
                )}
              </div>
              <Button size="sm" onClick={() => link(c)} disabled={pending}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="size-4" aria-hidden />
                )}
                {t("contributions.matchThisIsThem")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">
          {t("contributions.noCandidates")}
          {canAddMembers ? ` ${t("contributions.addThemAsNew")}` : ""}
        </p>
      )}

      <AddToRegisterDialog
        open={adding}
        onOpenChange={setAdding}
        person={person}
      />
    </div>
  );
}

function AddToRegisterDialog({
  open,
  onOpenChange,
  person,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  person: UnmatchedPerson;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const split = splitName(person.name);
  const [firstName, setFirstName] = useState(split.firstName);
  const [lastName, setLastName] = useState(split.lastName ?? "");
  const [phone, setPhone] = useState(person.phone ?? "");
  const [email, setEmail] = useState(person.email ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    start(async () => {
      const res = await addToRegister({
        contributorIds: person.contributorIds,
        firstName,
        lastName: lastName || null,
        phone: phone || null,
        email: email || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(`${firstName} is on the register`);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("contributions.addToRegisterTitle", { name: person.name })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            {t("contributions.addToRegisterBlurb")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("common.firstName")} htmlFor="match-first">
              <Input
                id="match-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </Field>
            <Field label={t("common.lastName")} htmlFor="match-last">
              <Input
                id="match-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={120}
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("common.phone")} htmlFor="match-phone">
              <Input
                id="match-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={40}
              />
            </Field>
            <Field label={t("common.email")} htmlFor="match-email">
              <Input
                id="match-email"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={200}
              />
            </Field>
          </div>
          {error && (
            <p className="text-destructive text-sm font-medium" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || firstName.trim().length < 2}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("contributions.matchAddToRegister")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DismissedRow({
  row,
}: {
  row: { id: string; name: string; potTitle: string; potId: string };
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.name}</p>
        <Link
          href={`/contributions/${row.potId}`}
          className="text-muted-foreground truncate text-xs hover:underline"
        >
          {row.potTitle}
        </Link>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await restoreMatch([row.id]);
            if (res.ok) {
              toast.success(t("contributions.backOnTheList"));
              router.refresh();
            } else toast.error(res.error);
          })
        }
      >
        {t("contributions.matchRestore")}
      </Button>
    </li>
  );
}
