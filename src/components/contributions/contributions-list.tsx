"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Clock,
  Gift,
  HandCoins,
  Handshake,
  Plus,
  Target,
  UserPlus,
  Users,
} from "lucide-react";
import type { ContributionListRow } from "@/lib/contributions";
import {
  dueLabel,
  peopleStillNeeded,
  type ContributionKind,
} from "@/lib/contributions-shared";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PotMeter,
  PotStatusBadge,
} from "@/components/contributions/pieces";
import {
  blankPot,
  PotFormDialog,
} from "@/components/contributions/pot-form-dialog";
import { useT } from "@/components/i18n-provider";

const KIND_ICON: Record<ContributionKind, typeof HandCoins> = {
  equal: Users,
  open: Target,
  gift: Gift,
};

/**
 * Every collection in the church, newest first.
 *
 * Grouped by what somebody opening this page is actually here to do: deal with
 * what is waiting, then look at what is running, then find something old. A flat
 * list sorted by date buries the one payment that needs confirming under
 * eighteen settled collections from last year.
 */
export function ContributionsList({
  rows,
  currency,
  today,
  canCreate,
  canSeeMatches,
  unmatchedCount,
  groups,
  members,
  restrictToGroupIds,
}: {
  rows: ContributionListRow[];
  currency: string;
  today: string;
  canCreate: boolean;
  canSeeMatches: boolean;
  unmatchedCount: number;
  groups: { id: string; name: string; type: string }[];
  members: { id: string; name: string }[];
  restrictToGroupIds: string[] | null;
}) {
  const t = useT();
  const [creating, setCreating] = useState(false);

  const { live, waiting, done } = useMemo(() => {
    const waiting = rows.filter((r) => r.awaiting > 0);
    const waitingIds = new Set(waiting.map((r) => r.id));
    return {
      waiting,
      live: rows.filter(
        (r) => !waitingIds.has(r.id) && (r.status === "open" || r.status === "draft"),
      ),
      done: rows.filter(
        (r) => !waitingIds.has(r.id) && (r.status === "closed" || r.status === "settled"),
      ),
    };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <>
        <EmptyState canCreate={canCreate} onCreate={() => setCreating(true)} />
        {canCreate && (
          <PotFormDialog
            open={creating}
            onOpenChange={setCreating}
            initial={blankPot(today)}
            currency={currency}
            groups={groups}
            members={members}
            restrictToGroupIds={restrictToGroupIds}
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {canCreate && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> {t("contributions.newOne")}
          </Button>
        )}
        {canSeeMatches && unmatchedCount > 0 && (
          <Button asChild variant="outline">
            <Link href="/contributions/people">
              <UserPlus className="size-4" aria-hidden />
              {t("contributions.unmatchedBadge", { count: unmatchedCount })}
            </Link>
          </Button>
        )}
      </div>

      {waiting.length > 0 && (
        <Section
          title={t("contributions.sectionWaiting")}
          hint={t("contributions.sectionWaitingHint")}
        >
          {waiting.map((r) => (
            <PotCard key={r.id} row={r} currency={currency} today={today} />
          ))}
        </Section>
      )}

      {live.length > 0 && (
        <Section title={t("contributions.sectionLive")}>
          {live.map((r) => (
            <PotCard key={r.id} row={r} currency={currency} today={today} />
          ))}
        </Section>
      )}

      {done.length > 0 && (
        <Section title={t("contributions.sectionDone")}>
          {done.map((r) => (
            <PotCard key={r.id} row={r} currency={currency} today={today} />
          ))}
        </Section>
      )}

      {canCreate && (
        <PotFormDialog
          open={creating}
          onOpenChange={setCreating}
          initial={blankPot(today)}
          currency={currency}
          groups={groups}
          members={members}
          restrictToGroupIds={restrictToGroupIds}
        />
      )}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-muted-foreground text-xs font-bold tracking-wider uppercase">
        {title}
      </h2>
      {hint && <p className="text-muted-foreground mt-0.5 text-sm">{hint}</p>}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function PotCard({
  row: r,
  currency,
  today,
}: {
  row: ContributionListRow;
  currency: string;
  today: string;
}) {
  const t = useT();
  const Icon = KIND_ICON[r.kind];
  const due = dueLabel(r.dueDate, today);
  const overdue = !!r.dueDate && r.dueDate < today && r.status === "open";
  const remaining = r.target ? Math.max(0, r.target - r.raised) : 0;
  const moreNeeded = peopleStillNeeded(remaining, r.perPersonAmount);

  return (
    <Link
      href={`/contributions/${r.id}`}
      className="bg-card hover:border-primary/40 group block rounded-2xl border p-4 transition-colors"
    >
      <div className="flex items-start gap-3">
        <span className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate font-bold">{r.title}</p>
            <PotStatusBadge status={r.status} />
            {r.awaiting > 0 && (
              <Badge variant="warning" className="gap-1">
                <Clock aria-hidden />{" "}
                {t("contributions.toCheck", { count: r.awaiting })}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-sm">
            {[
              r.groupName,
              r.honoureeName ? `for ${r.honoureeName}` : null,
              r.purpose,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <ChevronRight
          className="text-muted-foreground group-hover:text-primary mt-2 size-4 shrink-0"
          aria-hidden
        />
      </div>

      <div className="mt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-xl font-extrabold tabular-nums">
            {formatMoney(r.raised, currency)}
          </p>
          <p className="text-muted-foreground text-xs">
            <Users className="mr-1 inline size-3" aria-hidden />
            {r.givers}
            {r.people > 0 ? ` of ${r.people}` : ""} {t("contributions.givers").toLowerCase()}
          </p>
        </div>
        <PotMeter
          raised={r.raised}
          pending={r.pending + r.disputed}
          target={r.target}
          currency={currency}
          className="mt-2"
        />
      </div>

      <div className="text-muted-foreground mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {remaining > 0 && (
          <span className="font-medium">
            {t("contributions.toGo", {
              amount: formatMoneyCompact(remaining, currency),
            })}
            {moreNeeded
              ? ` — ${t("contributions.aboutPeopleAt", {
                  count: moreNeeded,
                  amount: formatMoneyCompact(r.perPersonAmount ?? 0, currency),
                })}`
              : ""}
          </span>
        )}
        {r.pending > 0 && (
          <span>
            {formatMoneyCompact(r.pending, currency)}{" "}
            {t("contributions.awaitingConfirmation").toLowerCase()}
          </span>
        )}
        {r.paidOut > 0 && (
          <span>
            {formatMoneyCompact(r.paidOut, currency)}{" "}
            {t("contributions.paidOut").toLowerCase()}
          </span>
        )}
        {due && (
          <span className={cn(overdue && "text-destructive font-semibold")}>{due}</span>
        )}
      </div>
    </Link>
  );
}

function EmptyState({
  canCreate,
  onCreate,
}: {
  canCreate: boolean;
  onCreate: () => void;
}) {
  const t = useT();
  return (
    <div className="bg-card rounded-2xl border p-8 text-center sm:p-12">
      <span className="bg-primary/10 text-primary mx-auto grid size-14 place-items-center rounded-2xl">
        <Handshake className="size-7" aria-hidden />
      </span>
      <h2 className="mt-4 text-xl font-extrabold tracking-tight">
        {t("contributions.emptyTitle")}
      </h2>
      <p className="text-muted-foreground mx-auto mt-2 max-w-lg text-sm">
        {t("contributions.emptyBody")}
      </p>
      {canCreate && (
        <Button className="mt-5" size="lg" onClick={onCreate}>
          <Plus className="size-4" aria-hidden /> {t("contributions.startFirst")}
        </Button>
      )}
    </div>
  );
}
