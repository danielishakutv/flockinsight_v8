import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, CheckCircle2, CircleSlash, XCircle } from "lucide-react";
import type { CronLiveness } from "@/lib/cron-run";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Cron liveness. The point is being able to tell "ran and had nothing to do"
 * apart from "has not run since the server rebooted".
 */
export function CronTable({ jobs }: { jobs: CronLiveness[] }) {
  const broken = jobs.filter((j) => j.overdue || j.lastOk === false).length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-lg">Scheduled jobs</CardTitle>
        {broken === 0 ? (
          <span className="text-success inline-flex items-center gap-1 text-xs font-bold">
            <CheckCircle2 className="size-4" /> All running
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-4" /> {broken} need attention
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-1">
        {jobs.map((j) => {
          const neverRan = j.lastRunAt === null;
          return (
            <div
              key={j.job}
              className={cn(
                "flex items-center gap-3 rounded-xl px-2 py-2",
                (j.overdue || j.lastOk === false) && "bg-amber-500/5",
              )}
            >
              <span className="shrink-0">
                {neverRan ? (
                  <CircleSlash className="text-muted-foreground size-4" />
                ) : j.overdue ? (
                  <AlertTriangle className="size-4 text-amber-500" />
                ) : j.lastOk === false ? (
                  <XCircle className="text-destructive size-4" />
                ) : (
                  <CheckCircle2 className="text-success size-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{j.label}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {neverRan
                    ? "Never run — add it to the crontab"
                    : `Ran ${formatDistanceToNowStrict(j.lastRunAt!, {
                        addSuffix: true,
                      })}${
                        j.lastDurationMs !== null
                          ? ` · took ${(j.lastDurationMs / 1000).toFixed(1)}s`
                          : ""
                      }`}
                  {j.lastError ? ` · ${j.lastError.slice(0, 60)}` : ""}
                </p>
              </div>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                every {j.intervalMinutes}m
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export type IntegrationStatus = {
  label: string;
  configured: boolean;
  /** Last real success/failure, not just whether env vars exist. */
  lastResult?: { ok: boolean; at: Date | null; error?: string | null } | null;
  note?: string;
};

/**
 * Integration health. Env vars being present says nothing about whether the
 * service works — the previous dashboard reported "Configured" while every
 * send could have been failing.
 */
export function IntegrationTable({ items }: { items: IntegrationStatus[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Integrations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {items.map((i) => (
          <div key={i.label} className="flex items-center gap-3 rounded-xl px-2 py-2">
            <span className="shrink-0">
              {!i.configured ? (
                <CircleSlash className="text-muted-foreground size-4" />
              ) : i.lastResult?.ok === false ? (
                <XCircle className="text-destructive size-4" />
              ) : (
                <CheckCircle2 className="text-success size-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{i.label}</p>
              <p className="text-muted-foreground truncate text-xs">
                {!i.configured
                  ? "Not configured"
                  : i.lastResult
                    ? i.lastResult.ok
                      ? `Working${
                          i.lastResult.at
                            ? ` · checked ${formatDistanceToNowStrict(i.lastResult.at, { addSuffix: true })}`
                            : ""
                        }`
                      : `Failing: ${i.lastResult.error ?? "unknown error"}`
                    : (i.note ?? "Configured — no live check yet")}
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
