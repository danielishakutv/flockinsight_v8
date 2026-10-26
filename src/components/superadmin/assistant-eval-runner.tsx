"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleSlash, CircleX, FlaskConical, Loader2, Square } from "lucide-react";
import { toast } from "sonner";
import {
  runAssistantEvalBatch,
  startAssistantEvalRun,
  type EvalRowResult,
} from "@/app/superadmin/assistant/eval-actions";
import { EVAL_CASES, EVAL_CONCURRENCY, evalBatches, evalTotals, type EvalVerdict } from "@/lib/assistant/eval-cases";
import { formatNanoUsd } from "@/lib/ai/pricing";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { cn } from "@/lib/utils";

type RowState = { status: "idle" } | { status: "running" } | { status: "done"; result: EvalRowResult };

const VERDICT: Record<EvalVerdict, { label: string; tone: string; Icon: typeof CircleCheck }> = {
  pass: { label: "Pass", tone: "text-emerald-700 dark:text-emerald-300", Icon: CircleCheck },
  fail: { label: "Fail", tone: "text-rose-700 dark:text-rose-300", Icon: CircleX },
  not_run: { label: "Not run", tone: "text-muted-foreground", Icon: CircleSlash },
};

const KIND_LABEL: Record<string, string> = {
  answered: "Answered",
  not_in_guides: "Not in the guides",
  out_of_scope: "Out of scope",
  refused: "Declined",
  truncated: "Cut off",
  failed: "Failed",
};

function idleRows(): Record<string, RowState> {
  return Object.fromEntries(EVAL_CASES.map((c) => [c.id, { status: "idle" } as RowState]));
}

/**
 * The "Test set" tab. Runs every case four at a time, one batch per request
 * (see eval-actions.ts for why), and fills each row in as its batch lands.
 * Results live in this page only: the calls themselves are on the AI page's
 * ledger, which is the durable record.
 */
export function AssistantEvalRunner({
  dormant,
  canOpenCalls,
}: {
  /** runAi's English sentence when that mode cannot run right now, else null. */
  dormant: { help: string | null; advisor: string | null };
  /** platform.ai.view: whether the call links lead anywhere for this admin. */
  canOpenCalls: boolean;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>(idleRows);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  const bothOff = dormant.help !== null && dormant.advisor !== null;
  const done = Object.values(rows).flatMap((r) => (r.status === "done" ? [r.result] : []));
  const totals = evalTotals(done.map((r) => r.verdict));
  const spent = done.reduce((sum, r) => sum + r.costNano, 0);

  async function run() {
    setError(null);
    stopRef.current = false;
    setRunning(true);
    try {
      const start = await startAssistantEvalRun();
      if (!start.ok) {
        setError(start.error);
        toast.error(start.error);
        return;
      }
      setRows(idleRows());
      for (const batch of evalBatches(start.caseIds, EVAL_CONCURRENCY)) {
        if (stopRef.current) break;
        setRows((prev) => ({ ...prev, ...Object.fromEntries(batch.map((id) => [id, { status: "running" }])) }));
        const res = await runAssistantEvalBatch({ caseIds: batch });
        if (!res.ok) {
          setRows((prev) => ({ ...prev, ...Object.fromEntries(batch.map((id) => [id, { status: "idle" }])) }));
          setError(res.error);
          toast.error(res.error);
          return;
        }
        setRows((prev) => ({
          ...prev,
          ...Object.fromEntries(res.rows.map((r) => [r.caseId, { status: "done", result: r } as RowState])),
        }));
      }
      if (stopRef.current) toast.message("Stopped. The questions already asked are below.");
    } catch (e) {
      console.error("[assistant-eval] run failed", e);
      setError("The run stopped: the server could not be reached. The rows already filled in are real results.");
      setRows((prev) =>
        Object.fromEntries(Object.entries(prev).map(([id, r]) => [id, r.status === "running" ? { status: "idle" } : r])),
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 max-w-2xl">
              <p className="flex items-center gap-2 font-semibold">
                <FlaskConical className="size-4" /> Test set
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                {EVAL_CASES.length} fixed questions, asked {EVAL_CONCURRENCY} at a time in the platform scope:
                how-to, the platform&apos;s figures, ministry practice, off-topic, prompt injection and a crisis. Run
                it after any change to a prompt or a model. Nothing is stored as a conversation and nobody&apos;s
                allowance is used, but every question is a real call on the platform budget and appears on the AI
                page.
              </p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              {running ? (
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    stopRef.current = true;
                  }}
                >
                  <Square className="size-4" /> Stop after this batch
                </Button>
              ) : null}
              <Button className="w-full sm:w-auto" onClick={run} disabled={running || bothOff} aria-busy={running}>
                {running ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
                {running ? `Running… ${done.length} of ${EVAL_CASES.length}` : "Run test set"}
              </Button>
            </div>
          </div>

          {(dormant.help || dormant.advisor) && (
            <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200" role="status">
              {bothOff ? (
                <p>Nothing can run right now: {dormant.advisor}</p>
              ) : (
                <>
                  {dormant.help && <p>Help questions will not run: {dormant.help}</p>}
                  {dormant.advisor && <p>Advisor questions will not run: {dormant.advisor}</p>}
                  <p className="mt-1 text-xs">Those rows will read &ldquo;Not run&rdquo;, which is not a failure.</p>
                </>
              )}
            </div>
          )}

          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}

          {done.length > 0 && (
            <p className="text-sm" aria-live="polite">
              <span className="font-semibold text-emerald-700 dark:text-emerald-300">{totals.pass} passed</span>
              {" · "}
              <span className={cn("font-semibold", totals.fail > 0 && "text-rose-700 dark:text-rose-300")}>
                {totals.fail} failed
              </span>
              {" · "}
              <span className="text-muted-foreground">{totals.not_run} not run</span>
              {" · "}
              <span className="text-muted-foreground tabular-nums">{formatNanoUsd(spent)} spent</span>
            </p>
          )}
        </CardContent>
      </Card>

      <ScrollableTable stickyFirstColumn label="Test set results">
        <table className="w-full min-w-[60rem] text-sm">
          <thead className="text-muted-foreground border-b text-left text-xs">
            <tr>
              <th className="px-3 py-2 font-medium">Question</th>
              <th className="px-3 py-2 font-medium">Verdict</th>
              <th className="px-3 py-2 font-medium">Expected</th>
              <th className="px-3 py-2 font-medium">Got</th>
              <th className="px-3 py-2 font-medium">Cited</th>
              <th className="px-3 py-2 font-medium">Figures</th>
              <th className="px-3 py-2 font-medium">Answer</th>
              <th className="px-3 py-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {EVAL_CASES.map((c) => {
              const state = rows[c.id] ?? { status: "idle" };
              const r = state.status === "done" ? state.result : null;
              const v = r ? VERDICT[r.verdict] : null;
              return (
                <tr key={c.id} className="align-top">
                  <td className="bg-card max-w-xs px-3 py-2.5">
                    <p className="font-medium break-words">{c.question}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {c.id} · {c.topic} · {c.mode}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    {state.status === "running" ? (
                      <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                        <Loader2 className="size-3.5 animate-spin" /> Asking…
                      </span>
                    ) : v && r ? (
                      <div className="space-y-1">
                        <span className={cn("inline-flex items-center gap-1 font-semibold", v.tone)}>
                          <v.Icon className="size-4" /> {v.label}
                        </span>
                        {r.notes.map((n) => (
                          <p key={n} className="text-muted-foreground max-w-[16rem] text-xs break-words">
                            {n}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">Not asked yet</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {c.expect === "answered" ? "Answered" : "Out of scope"}
                    {c.mustCite && (
                      <p className="text-muted-foreground text-xs">
                        cites {c.mustCite === "facts" ? "the figures" : "a guide"}
                      </p>
                    )}
                    {c.mustMention && (
                      <p className="text-muted-foreground text-xs">mentions {c.mustMention.join(" or ")}</p>
                    )}
                    {c.mustNotMention && <p className="text-muted-foreground text-xs">no amounts of money</p>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r?.kind ? (
                      <>
                        {KIND_LABEL[r.kind] ?? r.kind}
                        <p className="text-muted-foreground text-xs">{r.mode}</p>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5 text-xs">
                    {r && r.cited.length > 0 ? r.cited.join(", ") : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                    {r?.figuresOk === true ? (
                      "Checked"
                    ) : r?.figuresOk === false ? (
                      <span className="font-semibold text-rose-700 dark:text-rose-300">Not in the data</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="text-muted-foreground max-w-sm px-3 py-2.5 text-xs break-words">
                    {r?.preview || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs whitespace-nowrap tabular-nums">
                    {r ? formatNanoUsd(r.costNano) : "—"}
                    {r?.callId && canOpenCalls && (
                      <p>
                        <Link href={`/superadmin/ai/calls/${r.callId}`} className="text-primary hover:underline">
                          Call
                        </Link>
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
