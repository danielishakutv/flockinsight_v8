"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crown, Loader2, ShieldCheck, UserPlus, UserX } from "lucide-react";
import { toast } from "sonner";
import {
  addContributionCoAdmin,
  removeContributionManager,
  setContributionOwner,
} from "@/app/(app)/contributions/actions";
import type { ManagerRow } from "@/lib/contributions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Field } from "@/components/contributions/pieces";
import { useT } from "@/components/i18n-provider";

export type StaffOption = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

/**
 * Who runs this collection.
 *
 * Its own tab rather than a row in the settings dialog, because this is the
 * answer to a question people ask out loud — "who is handling the choir levy
 * now?" — and because handing a collection over is a deliberate act, not a
 * field you tab past while editing a deadline.
 *
 * The distinction between the two roles is spelled out on the screen rather than
 * left to the words "owner" and "co-admin", which mean whatever the reader
 * assumes. What a co-admin cannot do is the part worth being explicit about.
 */
export function ManagersPanel({
  potId,
  potTitle,
  managers,
  staff,
  canManage,
  currentUserId,
}: {
  potId: string;
  potTitle: string;
  managers: ManagerRow[];
  staff: StaffOption[];
  /** Whether this viewer may change who runs it — owner or administrator only. */
  canManage: boolean;
  currentUserId: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [handOver, setHandOver] = useState(false);
  const [adding, setAdding] = useState(false);

  const owner = managers.find((m) => m.role === "owner") ?? null;
  const coAdmins = managers.filter((m) => m.role === "coadmin");

  /** Team members not already on this collection. */
  const available = useMemo(() => {
    const taken = new Set(managers.map((m) => m.userId));
    return staff.filter((s) => !taken.has(s.userId));
  }, [staff, managers]);

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(done);
        setHandOver(false);
        setAdding(false);
        router.refresh();
      } else toast.error(res.error ?? t("common.somethingWentWrong"));
    });
  }

  return (
    <div className="space-y-4">
      {/* ---------- The owner ---------- */}
      <div className="bg-card rounded-2xl border p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-bold">
              <Crown className="text-primary size-4" aria-hidden />
              {t("contributions.theOwner")}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("contributions.ownerBlurb")}
            </p>
          </div>
          {canManage && available.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setHandOver(true)}>
              {t("contributions.handOver")}
            </Button>
          )}
        </div>

        {owner ? (
          <PersonRow
            name={owner.name}
            email={owner.email}
            you={owner.userId === currentUserId}
            badge={
              <Badge variant="default" className="gap-1">
                <Crown aria-hidden /> {t("contributions.roleOwner")}
              </Badge>
            }
          />
        ) : (
          /*
           * A collection whose owner's account was deleted, or one created
           * before owners were recorded. Said plainly rather than left blank:
           * money with nobody answerable for it is exactly the thing somebody
           * should be prompted to fix.
           */
          <div className="border-warning/40 bg-warning/5 mt-3 rounded-xl border p-3">
            <p className="text-sm font-semibold">{t("contributions.noOwner")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t("contributions.noOwnerBlurb")}
            </p>
            {canManage && available.length > 0 && (
              <Button size="sm" className="mt-3" onClick={() => setHandOver(true)}>
                {t("contributions.chooseOwner")}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ---------- Co-admins ---------- */}
      <div className="bg-card rounded-2xl border p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-bold">
              <ShieldCheck className="text-primary size-4" aria-hidden />
              {t("contributions.coAdmins")}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("contributions.coAdminBlurb")}
            </p>
          </div>
          {canManage && (
            <Button
              size="sm"
              onClick={() => setAdding(true)}
              disabled={available.length === 0}
            >
              <UserPlus className="size-4" aria-hidden />{" "}
              {t("contributions.addCoAdmin")}
            </Button>
          )}
        </div>

        {coAdmins.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">
            {t("contributions.noCoAdmins")}
          </p>
        ) : (
          <ul className="mt-1">
            {coAdmins.map((m) => (
              <li key={m.userId}>
                <PersonRow
                  name={m.name}
                  email={m.email}
                  you={m.userId === currentUserId}
                  badge={
                    <Badge variant="secondary">{t("contributions.roleCoAdmin")}</Badge>
                  }
                  action={
                    canManage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        aria-label={t("contributions.removeFromCollection", {
                          name: m.name,
                        })}
                        onClick={() =>
                          act(
                            () =>
                              removeContributionManager({
                                potId,
                                userId: m.userId,
                              }),
                            t("contributions.removed"),
                          )
                        }
                      >
                        <UserX className="size-4" aria-hidden />
                      </Button>
                    ) : null
                  }
                />
              </li>
            ))}
          </ul>
        )}

        {canManage && available.length === 0 && (
          <p className="text-muted-foreground mt-3 text-xs">
            {t("contributions.everyoneAlreadyOn")}
          </p>
        )}
      </div>

      {/* ---------- What each can do ---------- */}
      <div className="bg-muted/40 rounded-2xl border p-4 text-sm">
        <p className="font-semibold">{t("contributions.whoCanDoWhat")}</p>
        <ul className="text-muted-foreground mt-2 space-y-1">
          <li>• {t("contributions.bothCan")}</li>
          <li>• {t("contributions.onlyOwnerCan")}</li>
        </ul>
      </div>

      <PickPersonDialog
        open={handOver}
        onOpenChange={setHandOver}
        title={t("contributions.handOverTitle", { title: potTitle })}
        blurb={t("contributions.handOverBlurb")}
        confirmLabel={t("contributions.handOver")}
        options={available}
        pending={pending}
        onConfirm={(userId) =>
          act(
            () => setContributionOwner({ potId, userId }),
            t("contributions.handedOver"),
          )
        }
      />

      <PickPersonDialog
        open={adding}
        onOpenChange={setAdding}
        title={t("contributions.addCoAdmin")}
        blurb={t("contributions.addCoAdminBlurb")}
        confirmLabel={t("contributions.addCoAdmin")}
        options={available}
        pending={pending}
        onConfirm={(userId) =>
          act(
            () => addContributionCoAdmin({ potId, userId }),
            t("contributions.coAdminAdded"),
          )
        }
      />
    </div>
  );
}

function PersonRow({
  name,
  email,
  you,
  badge,
  action,
}: {
  name: string;
  email: string;
  you: boolean;
  badge: React.ReactNode;
  action?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl border p-3">
      <span className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-xl text-sm font-bold">
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 font-semibold">
          <span className="truncate">{name}</span>
          {you && (
            <span className="text-muted-foreground text-xs font-normal">
              ({t("contributions.you")})
            </span>
          )}
        </p>
        <p className="text-muted-foreground truncate text-xs">{email}</p>
      </div>
      {badge}
      {action}
    </div>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function PickPersonDialog({
  open,
  onOpenChange,
  title,
  blurb,
  confirmLabel,
  options,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  blurb: string;
  confirmLabel: string;
  options: StaffOption[];
  pending: boolean;
  onConfirm: (userId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {/* Fresh state per open — see the note on EntryDialog. */}
        <PickPersonBody
          blurb={blurb}
          confirmLabel={confirmLabel}
          options={options}
          pending={pending}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      </DialogContent>
    </Dialog>
  );
}

function PickPersonBody({
  blurb,
  confirmLabel,
  options,
  pending,
  onCancel,
  onConfirm,
}: {
  blurb: string;
  confirmLabel: string;
  options: StaffOption[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: (userId: string) => void;
}) {
  const t = useT();
  const [picked, setPicked] = useState<string>(options[0]?.userId ?? "");

  return (
    <>
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">{blurb}</p>
        <Field label={t("contributions.pickPerson")} htmlFor="mgr-person">
          <Select value={picked} onValueChange={setPicked}>
            <SelectTrigger id="mgr-person">
              <SelectValue placeholder={t("contributions.pickPerson")} />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.userId} value={o.userId}>
                  {o.name} — {o.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {options.length === 0 && (
          <p className="text-muted-foreground text-xs">
            {t("contributions.inviteFirst")}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => onConfirm(picked)} disabled={pending || !picked}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
