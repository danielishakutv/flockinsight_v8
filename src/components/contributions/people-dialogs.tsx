"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  importContributors,
  saveContributor,
  type ContributorInput,
} from "@/app/(app)/contributions/actions";
import type { ContributorRow } from "@/lib/contributions";
import { currencySymbol } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
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
import { Field, MoneyInput } from "@/components/contributions/pieces";
import { useT } from "@/components/i18n-provider";

const NONE = "__none__";

/** Adding or editing one person on a collection's list. */
export function PersonDialog({
  open,
  onOpenChange,
  potId,
  currency,
  members,
  editing,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  potId: string;
  currency: string;
  members: { id: string; name: string }[];
  editing?: ContributorRow | null;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? editing.name : t("contributions.addPerson")}
          </DialogTitle>
        </DialogHeader>
        {/* Fresh state per open — see the note on EntryDialog. */}
        <PersonForm
          onOpenChange={onOpenChange}
          potId={potId}
          currency={currency}
          members={members}
          editing={editing}
        />
      </DialogContent>
    </Dialog>
  );
}

function PersonForm({
  onOpenChange,
  potId,
  currency,
  members,
  editing,
}: {
  onOpenChange: (next: boolean) => void;
  potId: string;
  currency: string;
  members: { id: string; name: string }[];
  editing?: ContributorRow | null;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();

  const [memberId, setMemberId] = useState<string | null>(editing?.memberId ?? null);
  const [name, setName] = useState(editing?.name ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [expected, setExpected] = useState(
    editing?.expectedAmount != null ? String(editing.expectedAmount) : "",
  );
  const [anonymous, setAnonymous] = useState(editing?.isAnonymous ?? false);
  const [note, setNote] = useState(editing?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const payload: ContributorInput = {
      id: editing?.id,
      contributionId: potId,
      memberId,
      name,
      phone,
      email,
      expectedAmount: expected,
      isAnonymous: anonymous,
      note,
    };
    start(async () => {
      const res = await saveContributor(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(t("contributions.saved"));
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="space-y-4">
          <Field
            label={t("contributions.fromRegister")}
            htmlFor="person-member"
            hint={t("contributions.fromRegisterHint")}
          >
            <Select
              value={memberId ?? NONE}
              onValueChange={(next) => {
                const id = next === NONE ? null : next;
                setMemberId(id);
                const m = members.find((x) => x.id === id);
                if (m) setName(m.name);
              }}
            >
              <SelectTrigger id="person-member">
                <SelectValue placeholder={t("contributions.notOnRegister")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  {t("contributions.notOnRegister")}
                </SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t("contributions.nameLabel")} htmlFor="person-name">
            <Input
              id="person-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={160}
              autoComplete="off"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("contributions.phoneLabel")} htmlFor="person-phone">
              <Input
                id="person-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={40}
                autoComplete="off"
              />
            </Field>
            <Field label={t("contributions.emailLabel")} htmlFor="person-email">
              <Input
                id="person-email"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={200}
                autoComplete="off"
              />
            </Field>
          </div>

          <Field
            label={t("contributions.expectedLabel")}
            htmlFor="person-expected"
            hint={t("contributions.expectedHint")}
          >
            <MoneyInput
              id="person-expected"
              value={expected}
              onChange={setExpected}
              currencyPrefix={currencySymbol(currency)}
            />
          </Field>

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <label
                htmlFor="person-anon"
                className="text-sm font-semibold select-none"
              >
                {t("contributions.anonymousLabel")}
              </label>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t("contributions.anonymousHint")}
              </p>
            </div>
            <Switch id="person-anon" checked={anonymous} onCheckedChange={setAnonymous} />
          </div>

          <Field label={t("contributions.noteLabel")} htmlFor="person-note">
            <Textarea
              id="person-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </Field>

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
        <Button onClick={submit} disabled={pending || name.trim().length < 2}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {editing ? t("common.saveChanges") : t("contributions.addPerson")}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Pasting the list.
 *
 * The leader already has the names — in a WhatsApp message, in a note on their
 * phone, in a spreadsheet column. Forty dialogs is where software loses to a
 * notebook, so this takes whatever shape the paste arrives in and says plainly
 * what it did with it afterwards: how many were added, how many matched a member
 * record, how many were already there. A silent "done" after a bulk import is
 * how people end up with the list twice.
 */
export function PasteListDialog({
  open,
  onOpenChange,
  potId,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  potId: string;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("contributions.pasteListTitle")}</DialogTitle>
        </DialogHeader>
        {/* Fresh state per open, so a second paste does not start from the
            first one's text — see the note on EntryDialog. */}
        <PasteListForm onOpenChange={onOpenChange} potId={potId} />
      </DialogContent>
    </Dialog>
  );
}

function PasteListForm({
  onOpenChange,
  potId,
}: {
  onOpenChange: (next: boolean) => void;
  potId: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const lines = text
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean).length;

  function submit() {
    setError(null);
    start(async () => {
      const res = await importContributors({ contributionId: potId, text });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(
        t("contributions.pasteListResult", {
          added: res.added,
          linked: res.linked,
          skipped: res.skipped,
        }),
      );
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            {t("contributions.pasteListBlurb")}
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            placeholder={"Grace Udo\nEmeka Obi, 08031234567\nMary Bello, mary@example.com, 2000"}
            className="font-mono text-sm"
            aria-label={t("contributions.pasteListTitle")}
            autoFocus
          />
          <p className="text-muted-foreground text-xs">
            {lines === 0
              ? t("contributions.pasteNothingYet")
              : t("contributions.pasteReady", {
                  count: t("common.people", { count: lines }),
                })}
          </p>
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
        <Button onClick={submit} disabled={pending || lines === 0}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t("contributions.addPeopleCount", {
            count: t("common.people", { count: lines }),
          })}
        </Button>
      </DialogFooter>
    </>
  );
}
