import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import type { ActivationBoard, ActivationRow } from "@/lib/activation";
import type { NudgePlan } from "@/lib/activation-nudges";
import { NudgeControls } from "@/components/superadmin/nudge-controls";
import { shareLabel } from "@/lib/thin-data";
import {
  FunnelDots,
  HealthBadge,
  LastSeen,
} from "@/components/superadmin/health-badge";
import { Panel } from "@/components/superadmin/panel";

/**
 * The churches that signed up and never started, and where each one stopped.
 *
 * This is the board's whole argument: a stalled church is not a number in a
 * "needs attention" count, it is a named place with a person and a specific
 * thing they did not get past. Nine of these were invisible until now — the
 * only sign of them was a weekly reminder email nobody read.
 */
export function ActivationBoardPanel({
  board,
  nudges,
}: {
  board: ActivationBoard;
  nudges: { planned: NudgePlan[]; enabled: boolean; suppressedRecent: number };
}) {
  const { stalled, slipping, healthyCount, totalChurches } = board;

  return (
    <Panel
      title="Activation"
      sample={board.sample}
      kind="churches"
      action={
        <Link
          href="/superadmin/churches"
          className="text-muted-foreground hover:text-foreground shrink-0 text-xs font-semibold"
        >
          All churches
        </Link>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tally
          label="Never started"
          value={shareLabel(stalled.length, totalChurches)}
          tone={stalled.length > 0 ? "bad" : "good"}
        />
        <Tally
          label="Slipping"
          value={shareLabel(slipping.length, totalChurches)}
          tone={slipping.length > 0 ? "warn" : "good"}
        />
        <Tally
          label="Healthy"
          value={shareLabel(healthyCount, totalChurches)}
          tone="good"
        />
      </div>

      {stalled.length === 0 && slipping.length === 0 ? (
        <p className="text-success flex items-center justify-center gap-2 py-4 text-sm font-semibold">
          <CheckCircle2 aria-hidden className="size-4" />
          Everyone who signed up is using it.
        </p>
      ) : (
        <div className="space-y-4">
          {stalled.length > 0 && (
            <Group
              heading="Signed up, never started"
              hint="These have not got past their first step. They need a person, not a reminder."
              rows={stalled}
            />
          )}
          {slipping.length > 0 && (
            <Group
              heading="Started, then went quiet"
              hint="These knew how to use it and stopped — a different conversation."
              rows={slipping}
            />
          )}
        </div>
      )}

      {stalled.length > 0 && (
        <NudgeControls
          planned={nudges.planned}
          enabled={nudges.enabled}
          suppressedRecent={nudges.suppressedRecent}
        />
      )}
    </Panel>
  );
}

function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad";
}) {
  const colour =
    tone === "bad"
      ? "text-destructive"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-success";
  return (
    <div className="rounded-xl border p-3">
      <div className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">
        {label}
      </div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${colour}`}>{value}</div>
    </div>
  );
}

function Group({
  heading,
  hint,
  rows,
}: {
  heading: string;
  hint: string;
  rows: ActivationRow[];
}) {
  return (
    <div>
      <h3 className="text-[11px] font-bold tracking-wide uppercase">{heading}</h3>
      <p className="text-muted-foreground mt-0.5 mb-2 text-xs leading-relaxed">{hint}</p>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.churchId}>
            <Link
              href={`/superadmin/churches/${r.churchId}`}
              className="group hover:bg-accent/60 flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-sm font-semibold">{r.name}</span>
                  <HealthBadge health={r.health} />
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs leading-snug wrap-anywhere">
                  {r.stalledDetail}
                </p>
                <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                  <FunnelDots completed={r.funnelCompleted} />
                  <span>{r.daysSinceSignup}d since signup</span>
                  <span aria-hidden>·</span>
                  <LastSeen at={r.lastSeenAt} />
                </div>
              </div>
              <ArrowRight
                aria-hidden
                className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
