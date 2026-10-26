import Link from "next/link";
import { and, count, desc, eq, gt, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  assistantAnswer,
  assistantConversation,
  assistantMessage,
  church,
} from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import { aiReadiness } from "@/lib/ai/run-ai";
import { AssistantQueue, type QueueItem } from "@/components/superadmin/assistant-queue";
import {
  AssistantTranscripts,
  type TranscriptRow,
} from "@/components/superadmin/assistant-transcripts";
import { AssistantEvalRunner } from "@/components/superadmin/assistant-eval-runner";
import { NewCannedAnswerButton } from "@/components/superadmin/assistant-answer-editor";
import { groundedFromStored, type AssistantMode } from "@/lib/assistant/shared";
import { cn } from "@/lib/utils";

export const metadata = { title: "Assistant · Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const TABS = [
  { key: "queue", label: "Queue" },
  { key: "answers", label: "Canned answers" },
  { key: "transcripts", label: "Transcripts" },
  { key: "test", label: "Test set" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const MODES: { key: AssistantMode; label: string }[] = [
  { key: "help", label: "Help" },
  { key: "advisor", label: "Advisor" },
];

function pageOf(v: string | undefined): number {
  const n = Number.parseInt(v ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 1;
}

function modeOf(v: string | undefined): AssistantMode | null {
  return v === "help" || v === "advisor" ? v : null;
}

/**
 * The reviewed pipeline behind the assistant: the answers that need a look
 * (the queue), the canned answers that grow out of them, the transcripts, and
 * the test set that checks the prompts still behave. English only, like the
 * rest of /superadmin.
 */
export default async function SuperadminAssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string; q?: string; scope?: string; mode?: string }>;
}) {
  const access = await requirePlatform("platform.assistant.review");
  const sp = await searchParams;
  const tab: Tab = TABS.some((x) => x.key === sp.tab) ? (sp.tab as Tab) : "queue";
  const page = pageOf(sp.page);
  const mode = modeOf(sp.mode);

  // One grouped aggregate over the last 30 days, per mode; no correlated subquery.
  const statRows = await db
    .select({
      mode: assistantMessage.mode,
      questions: sql<number>`count(*) filter (where ${assistantMessage.role} = 'user')`,
      answers: sql<number>`count(*) filter (where ${assistantMessage.role} = 'assistant')`,
      answered: sql<number>`count(*) filter (where ${assistantMessage.answerKind} = 'answered')`,
      outOfScope: sql<number>`count(*) filter (where ${assistantMessage.answerKind} = 'out_of_scope')`,
      notInGuides: sql<number>`count(*) filter (where ${assistantMessage.answerKind} = 'not_in_guides')`,
      helpfulNo: sql<number>`count(*) filter (where ${assistantMessage.helpful} = false)`,
      figuresUnchecked: sql<number>`count(*) filter (where ${assistantMessage.figuresOk} = false)`,
    })
    .from(assistantMessage)
    .where(gt(assistantMessage.createdAt, sql`now() - interval '30 days'`))
    .groupBy(assistantMessage.mode);
  const [{ open }] = await db
    .select({ open: count() })
    .from(assistantMessage)
    .where(eq(assistantMessage.reviewStatus, "open"));

  const statsFor = (m: AssistantMode) => {
    const r = statRows.find((x) => x.mode === m);
    const answers = Number(r?.answers ?? 0);
    const answered = Number(r?.answered ?? 0);
    return {
      questions: Number(r?.questions ?? 0),
      answered,
      answeredPct: answers > 0 ? Math.round((answered / answers) * 100) : null,
      outOfScope: Number(r?.outOfScope ?? 0),
      notInGuides: Number(r?.notInGuides ?? 0),
      helpfulNo: Number(r?.helpfulNo ?? 0),
      figuresUnchecked: Number(r?.figuresUnchecked ?? 0),
    };
  };

  const tabHref = (key: Tab) => `/superadmin/assistant?tab=${key}${mode && key !== "test" ? `&mode=${mode}` : ""}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Assistant</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What staff ask the in-app assistant, the answers that need a look, and the canned answers a reviewer
          approved. Questions are stored already scrubbed; staff names are never shown. Advisor answers quote a
          church&apos;s own counts and percentages, never names or amounts of money.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold">
          Last 30 days, by the mode that answered · {Number(open)} open in the queue
        </p>
        {MODES.map((m) => {
          const s = statsFor(m.key);
          return (
            <div key={m.key} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label={`${m.label}: questions`} value={String(s.questions)} />
              <Stat
                label="Answered"
                value={String(s.answered)}
                sub={s.answeredPct === null ? undefined : `${s.answeredPct}% of answers`}
              />
              <Stat label="Out of scope" value={String(s.outOfScope)} />
              <Stat label="Not helpful" value={String(s.helpfulNo)} />
              {m.key === "advisor" ? (
                <Stat label="Figures not in the data" value={String(s.figuresUnchecked)} />
              ) : (
                <Stat label="Not in the guides" value={String(s.notInGuides)} />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2 border-b">
        <div className="flex flex-wrap gap-1">
          {TABS.map((x) => (
            <Link
              key={x.key}
              href={tabHref(x.key)}
              className={cn(
                "relative px-3 py-2 text-sm font-semibold transition-colors",
                tab === x.key ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {x.label}
              {tab === x.key && (
                <span className="bg-primary absolute inset-x-2 -bottom-px h-0.5 rounded-full" />
              )}
            </Link>
          ))}
        </div>
        {(tab === "queue" || tab === "transcripts") && (
          <ModeFilter tab={tab} mode={mode} q={sp.q ?? ""} scope={sp.scope ?? ""} />
        )}
      </div>

      {tab === "queue" && (
        <QueueTab page={page} mode={mode} seesPlatformFigures={access.perms.has("platform.overview.view")} />
      )}
      {tab === "answers" && <AnswersTab />}
      {tab === "transcripts" && <TranscriptsTab page={page} q={sp.q ?? ""} scope={sp.scope ?? ""} mode={mode} />}
      {tab === "test" && <TestTab canOpenCalls={access.perms.has("platform.ai.view")} />}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card rounded-2xl border p-3 shadow-sm">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
    </div>
  );
}

/** Links rather than a form, so a filtered view is a URL that can be shared. */
function ModeFilter({ tab, mode, q, scope }: { tab: Tab; mode: AssistantMode | null; q: string; scope: string }) {
  const href = (m: AssistantMode | null) => {
    const extra = tab === "transcripts" ? `&q=${encodeURIComponent(q)}&scope=${encodeURIComponent(scope)}` : "";
    return `/superadmin/assistant?tab=${tab}${m ? `&mode=${m}` : ""}${extra}`;
  };
  const options: { key: AssistantMode | null; label: string }[] = [{ key: null, label: "Both modes" }, ...MODES];
  return (
    <div className="flex gap-1 pb-1.5 text-xs" role="group" aria-label="Mode">
      {options.map((o) => (
        <Link
          key={o.key ?? "all"}
          href={href(o.key)}
          aria-current={mode === o.key ? "true" : undefined}
          className={cn(
            "rounded-full border px-2.5 py-1 font-medium",
            mode === o.key ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

function Pager({ page, hasMore, base }: { page: number; hasMore: boolean; base: string }) {
  if (page === 1 && !hasMore) return null;
  return (
    <div className="flex justify-between text-sm">
      {page > 1 ? (
        <Link className="text-primary font-medium" href={`${base}&page=${page - 1}`}>
          ← Newer
        </Link>
      ) : (
        <span />
      )}
      {hasMore && (
        <Link className="text-primary font-medium" href={`${base}&page=${page + 1}`}>
          Older →
        </Link>
      )}
    </div>
  );
}

/*
 * The most specific reason first. An advisor answer whose figures could not
 * be found in the data is in the queue for that, even if somebody also said
 * it did not help: the figure is what a reviewer has to check.
 */
function reasonFor(
  kind: string | null,
  sources: string[],
  helpful: boolean | null,
  figuresOk: boolean | null,
): QueueItem["reason"] {
  if (figuresOk === false) return "Figures not in the data";
  if (kind === "not_in_guides") return "Not in the guides";
  if (kind === "refused") return "Declined";
  if (kind === "truncated") return "Cut off";
  if (kind === "failed") return "Failed";
  if (helpful === false) return "Unhelpful";
  if (groundedFromStored(kind, sources) === null) return "No sources";
  return "Unhelpful";
}

/**
 * Shown in place of a platform-scope advisor answer to a reviewer without the
 * Overview permission: those answers quote the platform's own figures, which
 * that permission guards on every other page. Act-as answers sit in the same
 * scope and quote a church's figures; they are withheld by the same rule.
 */
const PLATFORM_FIGURES_WITHHELD =
  "This answer was written from platform figures, which need the Overview permission to read. Ask an admin who has it to review this one.";

async function QueueTab({
  page,
  mode,
  seesPlatformFigures,
}: {
  page: number;
  mode: AssistantMode | null;
  seesPlatformFigures: boolean;
}) {
  const where: SQL[] = [eq(assistantMessage.reviewStatus, "open"), eq(assistantMessage.role, "assistant")];
  if (mode) where.push(eq(assistantMessage.mode, mode));
  const rows = await db
    .select({
      id: assistantMessage.id,
      conversationId: assistantMessage.conversationId,
      content: assistantMessage.content,
      answerKind: assistantMessage.answerKind,
      sources: assistantMessage.sources,
      helpful: assistantMessage.helpful,
      mode: assistantMessage.mode,
      figuresOk: assistantMessage.figuresOk,
      createdAt: assistantMessage.createdAt,
      churchId: assistantMessage.churchId,
      churchName: church.name,
    })
    .from(assistantMessage)
    .leftJoin(church, eq(church.id, assistantMessage.churchId))
    .where(and(...where))
    .orderBy(desc(assistantMessage.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);
  const hasMore = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);

  // The question for each answer: the latest user row at or before it, picked in JS.
  const convIds = [...new Set(visible.map((r) => r.conversationId))];
  const questions = convIds.length
    ? await db
        .select({
          conversationId: assistantMessage.conversationId,
          content: assistantMessage.content,
          createdAt: assistantMessage.createdAt,
        })
        .from(assistantMessage)
        .where(and(inArray(assistantMessage.conversationId, convIds), eq(assistantMessage.role, "user")))
    : [];

  const items: QueueItem[] = visible.map((r) => {
    const q = questions
      .filter((x) => x.conversationId === r.conversationId && x.createdAt <= r.createdAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return {
      id: r.id,
      conversationId: r.conversationId,
      churchName: r.churchName ?? "Platform",
      reason: reasonFor(r.answerKind, r.sources ?? [], r.helpful, r.figuresOk),
      mode: r.mode === "advisor" ? "advisor" : "help",
      question: q?.content ?? "",
      answer:
        r.mode === "advisor" && r.churchId === null && !seesPlatformFigures ? PLATFORM_FIGURES_WITHHELD : r.content,
      createdAt: r.createdAt.toISOString(),
    };
  });

  return (
    <div className="space-y-3">
      <AssistantQueue items={items} />
      <Pager page={page} hasMore={hasMore} base={`/superadmin/assistant?tab=queue${mode ? `&mode=${mode}` : ""}`} />
    </div>
  );
}

async function AnswersTab() {
  const rows = await db
    .select({
      id: assistantAnswer.id,
      question: assistantAnswer.question,
      status: assistantAnswer.status,
      draftedByAi: assistantAnswer.draftedByAi,
      guideSlug: assistantAnswer.guideSlug,
      updatedAt: assistantAnswer.updatedAt,
    })
    .from(assistantAnswer)
    .orderBy(desc(assistantAnswer.updatedAt))
    .limit(500);

  const groups = [
    { key: "draft", label: "Drafts", hint: "Not used by the assistant until approved." },
    { key: "approved", label: "Approved", hint: "Shown to every church's assistant." },
    { key: "retired", label: "Retired", hint: "Withdrawn; kept for the record." },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <NewCannedAnswerButton />
      </div>
      {groups.map((g) => {
        const list = rows.filter((r) => r.status === g.key);
        return (
          <section key={g.key} className="space-y-2">
            <div>
              <h2 className="text-sm font-semibold">
                {g.label} <span className="text-muted-foreground font-normal">({list.length})</span>
              </h2>
              <p className="text-muted-foreground text-xs">{g.hint}</p>
            </div>
            {list.length === 0 ? (
              <p className="text-muted-foreground rounded-2xl border border-dashed p-4 text-center text-sm">
                None.
              </p>
            ) : (
              <div className="space-y-2">
                {list.map((r) => (
                  <Link
                    key={r.id}
                    href={`/superadmin/assistant/answers/${r.id}`}
                    className="bg-card flex flex-wrap items-center gap-2 rounded-2xl border p-3 shadow-sm transition hover:shadow-md"
                  >
                    <p className="min-w-0 flex-1 truncate font-medium">
                      {r.question || <span className="text-muted-foreground">Untitled draft</span>}
                    </p>
                    {r.draftedByAi && (
                      <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                        AI first draft
                      </span>
                    )}
                    {r.guideSlug && (
                      <span className="text-muted-foreground text-xs">→ {r.guideSlug}</span>
                    )}
                    <span className="text-muted-foreground text-xs">
                      {r.updatedAt.toISOString().slice(0, 10)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

async function TranscriptsTab({
  page,
  q,
  scope,
  mode,
}: {
  page: number;
  q: string;
  scope: string;
  mode: AssistantMode | null;
}) {
  const filters: SQL[] = [];
  if (scope === "church" || scope === "platform") filters.push(eq(assistantConversation.scope, scope));
  const search = q.trim().slice(0, 80);
  if (search) filters.push(ilike(church.name, `%${search.replace(/[%_\\]/g, "\\$&")}%`));
  if (scope === "platform") filters.push(isNull(assistantConversation.churchId));
  if (mode) {
    // Conversations with at least one answer in that mode: a builder subquery, never correlated raw SQL.
    filters.push(
      inArray(
        assistantConversation.id,
        db
          .select({ id: assistantMessage.conversationId })
          .from(assistantMessage)
          .where(and(eq(assistantMessage.role, "assistant"), eq(assistantMessage.mode, mode))),
      ),
    );
  }

  const rows = await db
    .select({
      id: assistantConversation.id,
      scope: assistantConversation.scope,
      title: assistantConversation.title,
      messageCount: assistantConversation.messageCount,
      lastMessageAt: assistantConversation.lastMessageAt,
      deletedAt: assistantConversation.deletedAt,
      contextChurchId: assistantConversation.contextChurchId,
      locale: assistantConversation.locale,
      churchName: church.name,
    })
    .from(assistantConversation)
    .leftJoin(church, eq(church.id, assistantConversation.churchId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(assistantConversation.lastMessageAt))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);
  const hasMore = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);

  // The kinds and modes used per conversation: one grouped aggregate, joined in JS.
  const ids = visible.map((r) => r.id);
  const kinds = ids.length
    ? await db
        .select({
          conversationId: assistantMessage.conversationId,
          kind: assistantMessage.answerKind,
          mode: assistantMessage.mode,
          n: count(),
        })
        .from(assistantMessage)
        .where(and(inArray(assistantMessage.conversationId, ids), eq(assistantMessage.role, "assistant")))
        .groupBy(assistantMessage.conversationId, assistantMessage.answerKind, assistantMessage.mode)
    : [];

  // The church a superadmin was acting as: names joined in JS, like the rest.
  const contextIds = [...new Set(visible.map((r) => r.contextChurchId).filter((id): id is string => !!id))];
  const contextNames = contextIds.length
    ? new Map(
        (await db.select({ id: church.id, name: church.name }).from(church).where(inArray(church.id, contextIds))).map(
          (c) => [c.id, c.name],
        ),
      )
    : new Map<string, string>();

  const list: TranscriptRow[] = visible.map((r) => {
    const mine = kinds.filter((k) => k.conversationId === r.id);
    const byKind = new Map<string, number>();
    const byMode = new Map<string, number>();
    for (const k of mine) {
      if (k.kind) byKind.set(k.kind, (byKind.get(k.kind) ?? 0) + Number(k.n));
      byMode.set(k.mode, (byMode.get(k.mode) ?? 0) + Number(k.n));
    }
    return {
      id: r.id,
      churchName: r.scope === "platform" ? "Platform" : (r.churchName ?? "Deleted church"),
      actingAs: r.contextChurchId ? (contextNames.get(r.contextChurchId) ?? "a deleted church") : null,
      title: r.title,
      scope: r.scope,
      messageCount: r.messageCount,
      lastMessageAt: r.lastMessageAt.toISOString(),
      deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
      locale: r.locale,
      kinds: [...byKind].map(([kind, n]) => ({ kind, n })),
      modes: [...byMode].map(([m, n]) => ({ mode: m, n })),
    };
  });

  const base = `/superadmin/assistant?tab=transcripts&q=${encodeURIComponent(search)}&scope=${encodeURIComponent(scope)}${mode ? `&mode=${mode}` : ""}`;
  return (
    <div className="space-y-3">
      <AssistantTranscripts rows={list} q={search} scope={scope} mode={mode ?? ""} />
      <Pager page={page} hasMore={hasMore} base={base} />
    </div>
  );
}

/** Whether each mode could run right now, said before anyone presses Run. */
async function TestTab({ canOpenCalls }: { canOpenCalls: boolean }) {
  const [help, advisor] = await Promise.all([
    aiReadiness({ churchId: null, feature: "chat" }),
    aiReadiness({ churchId: null, feature: "advisor" }),
  ]);
  return (
    <AssistantEvalRunner
      canOpenCalls={canOpenCalls}
      dormant={{
        help: "ready" in help ? null : help.message,
        advisor: "ready" in advisor ? null : advisor.message,
      }}
    />
  );
}
