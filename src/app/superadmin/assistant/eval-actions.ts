"use server";

import { z } from "zod";
import { requirePlatform } from "@/lib/platform-access";
import { recordAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { runAssistantEvalCase } from "@/lib/assistant/server";
import { resolveSources } from "@/lib/assistant/chat";
import {
  EVAL_CASES,
  EVAL_CONCURRENCY,
  answerPreview,
  gradeEvalCase,
  type EvalGrade,
  type EvalVerdict,
} from "@/lib/assistant/eval-cases";
import type { AnswerKind, AssistantMode } from "@/lib/assistant/shared";

/*
 * The test set, run from /superadmin/assistant. Every question goes through
 * runAssistantEvalCase: the real prompts, turn builders, runAi and parsing,
 * in the platform scope, with nothing stored as a conversation and no
 * allowance claimed. Each call is on the platform budget and in the ai_call
 * ledger under the reviewer's id.
 *
 * Why two actions, and why batches. Next dispatches a client's server
 * actions one at a time, so "four at once" can only happen inside a single
 * action. And a whole run in one request would take minutes, past the 100
 * seconds Cloudflare holds a request open. So the page calls
 * runAssistantEvalBatch once per batch of four (one batch is never longer
 * than the slowest of its questions, at most the advisor's 60-second
 * timeout), and shows each row as it lands.
 *
 * The run is audited once, when it starts, rather than once per batch: one
 * press of "Run test set" is one line in the log. A batch called on its own
 * is still permission-checked and rate-limited, and its calls are on the
 * ledger.
 */

export type EvalStartResult = { ok: true; caseIds: string[] } | { ok: false; error: string };

export type EvalRowResult = {
  caseId: string;
  verdict: EvalVerdict;
  notes: EvalGrade["notes"];
  /** What answered. Null when nothing was sent. */
  mode: AssistantMode | null;
  kind: AnswerKind | null;
  /** Chip titles: "Your figures", a guide title, "Approved answer". */
  cited: string[];
  figuresOk: boolean | null;
  preview: string;
  costNano: number;
  callId: string | null;
};

export type EvalBatchResult = { ok: true; rows: EvalRowResult[] } | { ok: false; error: string };

const CASE_BY_ID = new Map(EVAL_CASES.map((c) => [c.id, c]));

export async function startAssistantEvalRun(): Promise<EvalStartResult> {
  const admin = await requirePlatform("platform.assistant.review");
  // A run is about two dozen billed calls: twice in ten minutes is plenty.
  const rl = rateLimit(`assistant-eval-run:${admin.id}`, 2, 600_000);
  if (!rl.ok) {
    return { ok: false, error: `The test set was run twice in the last ten minutes. Try again in ${Math.ceil(rl.retryAfterSec / 60)} min.` };
  }
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "platform.assistant.eval",
    summary: `Ran the assistant test set (${EVAL_CASES.length} questions, platform scope)`,
    meta: { cases: EVAL_CASES.length, concurrency: EVAL_CONCURRENCY },
  });
  return { ok: true, caseIds: EVAL_CASES.map((c) => c.id) };
}

const BatchInput = z
  .object({ caseIds: z.array(z.string().min(1).max(80)).min(1).max(EVAL_CONCURRENCY) })
  .strict();

/** Up to EVAL_CONCURRENCY cases, asked at the same time, graded on the server. */
export async function runAssistantEvalBatch(input: unknown): Promise<EvalBatchResult> {
  const admin = await requirePlatform("platform.assistant.review");
  const parsed = BatchInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Send 1 to ${EVAL_CONCURRENCY} test-set case ids.` };
  const cases = parsed.data.caseIds.map((id) => CASE_BY_ID.get(id));
  if (cases.some((c) => !c)) return { ok: false, error: "That test case no longer exists. Reload the page." };

  // Enough for three full runs; a loop calling this on its own stops here.
  const rl = rateLimit(`assistant-eval-batch:${admin.id}`, 24, 600_000);
  if (!rl.ok) return { ok: false, error: `Too many test batches. Try again in ${Math.ceil(rl.retryAfterSec / 60)} min.` };

  /*
   * Advisor cases answer from the platform's own figures (revenue change, churn
   * and growth), which the Overview permission guards everywhere else. A
   * reviewer without it can still run the help and off-topic cases; the
   * advisor ones are not asked at all, rather than asked and hidden, so they
   * cost nothing and show nothing.
   */
  const seesPlatformFigures = admin.perms.has("platform.overview.view");

  const rows = await Promise.all(
    cases.map(async (c): Promise<EvalRowResult> => {
      const testCase = c!;
      if (testCase.mode === "advisor" && !seesPlatformFigures) {
        return {
          caseId: testCase.id,
          verdict: "not_run",
          notes: ["Advisor cases answer from platform figures, which need the Overview permission. Ask an admin who has it to run them."],
          mode: null,
          kind: null,
          cited: [],
          figuresOk: null,
          preview: "",
          costNano: 0,
          callId: null,
        };
      }
      try {
        const res = await runAssistantEvalCase({
          mode: testCase.mode,
          question: testCase.question,
          actorUserId: admin.id,
        });
        const grade = gradeEvalCase(testCase, res);
        if (!res.ok) {
          return {
            caseId: testCase.id,
            ...grade,
            mode: null,
            kind: null,
            cited: [],
            figuresOk: null,
            preview: "",
            costNano: 0,
            callId: null,
          };
        }
        return {
          caseId: testCase.id,
          ...grade,
          mode: res.mode,
          kind: res.kind,
          // "Your figures" is a church's chip; here they are the platform's.
          cited: resolveSources(res.sources).map((s) => (s.ref === "facts" ? "Platform figures" : s.title)),
          figuresOk: res.figuresOk,
          preview: answerPreview(res.body),
          costNano: res.costNano,
          callId: res.callId,
        };
      } catch (e) {
        // runAi throws on a database error rather than returning a reason. One
        // case failing that way must not take the other three down with it.
        console.error("[assistant-eval] case threw", { caseId: testCase.id, error: e instanceof Error ? e.message : e });
        return {
          caseId: testCase.id,
          verdict: "not_run",
          notes: ["The server failed before an answer came back. The error is in the server log as [assistant-eval]."],
          mode: null,
          kind: null,
          cited: [],
          figuresOk: null,
          preview: "",
          costNano: 0,
          callId: null,
        };
      }
    }),
  );
  return { ok: true, rows };
}
