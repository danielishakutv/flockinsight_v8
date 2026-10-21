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
import { AssistantQueue, type QueueItem } from "@/components/superadmin/assistant-queue";
import {
  AssistantTranscripts,
  type TranscriptRow,
} from "@/components/superadmin/assistant-transcripts";
import { NewCannedAnswerButton } from "@/components/superadmin/assistant-answer-editor";
import { groundedFromStored } from "@/lib/assistant/shared";
import { cn } from "@/lib/utils";

export const metadata = { title: "Assistant · Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const TABS = [
  { key: "queue", label: "Queue" },
  { key: "answers", label: "Canned answers" },
  { key: "transcripts", label: "Transcripts" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function pageOf(v: string | undefined): number {
  const n = Number.parseInt(v ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 1;
}

/**
 * The reviewed pipeline behind the help assistant: the questions the guides
 * did not answer (the queue), the canned answers that grow out of them, and
 * the transcripts. English only, like the rest of /superadmin.
 */
export default async function SuperadminAssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string; q?: string; scope?: string }>;
}) {
  await requirePlatform("platform.assistant.review");
  const sp = await searchParams;
  const tab: Tab = TABS.some((x) => x.key === sp.tab) ? (sp.tab as Tab) : "queue";
  const page = pageOf(sp.page);

  // One grouped aggregate over the last 30 days; no correlated subquery.
  const [stats] = await db
    .select({
      questions: sql<number>`count(*) filter (where ${assistantMessage.role} = 'user')`,
      answers: sql<number>`count(*) filter (where ${assistantMessage.role} = 'assistant')`,
      answered: sql<number>`count(*) filter (where ${assistantMessage.answerKind} = 'answered')`,
      helpfulYes: sql<number>`count(*) filter (where ${assistantMessage.helpful} = true)`,
      helpfulNo: sql<number>`count(*) filter (where ${assistantMessage.helpful} = false)`,
    })
    .from(assistantMessage)
    .where(gt(assistantMessage.createdAt, sql`now() - interval '30 days'`));
  const [{ open }] = await db
    .select({ open: count() })
    .from(assistantMessage)
    .where(eq(assistantMessage.reviewStatus, "open"));

  const answers = Number(stats?.answers ?? 0);
  const answeredPct = answers > 0 ? Math.round((Number(stats?.answered ?? 0) / answers) * 100) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Help assistant</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What staff ask the in-app assistant, what it could not answer, and the canned answers a
          reviewer approved. Questions are stored already scrubbed; staff names are never shown.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Questions (30 days)" value={String(Number(stats?.questions ?? 0))} />
        <Stat label="Answered from guides" value={answeredPct === null ? "—" : `${answeredPct}%`} />
        <Stat label="Helpful" value={String(Number(stats?.helpfulYes ?? 0))} />
        <Stat label="Not helpful" value={String(Number(stats?.helpfulNo ?? 0))} />
        <Stat label="Open in queue" value={String(Number(open))} />
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((x) => (
          <Link
            key={x.key}
            href={`/superadmin/assistant?tab=${x.key}`}
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

      {tab === "queue" && <QueueTab page={page} />}
      {tab === "answers" && <AnswersTab />}
      {tab === "transcripts" && <TranscriptsTab page={page} q={sp.q ?? ""} scope={sp.scope ?? ""} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-2xl border p-3 shadow-sm">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
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

function reasonFor(kind: string | null, sources: string[], helpful: boolean | null): QueueItem["reason"] {
  if (kind === "not_in_guides") return "Not in the guides";
  if (kind === "refused") return "Declined";
  if (kind === "truncated") return "Cut off";
  if (kind === "failed") return "Failed";
  if (helpful === false) return "Unhelpful";
  if (groundedFromStored(kind, sources) === null) return "No sources";
  return "Unhelpful";
}

async function QueueTab({ page }: { page: number }) {
  const rows = await db
    .select({
      id: assistantMessage.id,
      conversationId: assistantMessage.conversationId,
      content: assistantMessage.content,
      answerKind: assistantMessage.answerKind,
      sources: assistantMessage.sources,
      helpful: assistantMessage.helpful,
      createdAt: assistantMessage.createdAt,
      churchName: church.name,
    })
    .from(assistantMessage)
    .leftJoin(church, eq(church.id, assistantMessage.churchId))
    .where(and(eq(assistantMessage.reviewStatus, "open"), eq(assistantMessage.role, "assistant")))
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
      reason: reasonFor(r.answerKind, r.sources ?? [], r.helpful),
      question: q?.content ?? "",
      answer: r.content,
      createdAt: r.createdAt.toISOString(),
    };
  });

  return (
    <div className="space-y-3">
      <AssistantQueue items={items} />
      <Pager page={page} hasMore={hasMore} base="/superadmin/assistant?tab=queue" />
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

async function TranscriptsTab({ page, q, scope }: { page: number; q: string; scope: string }) {
  const filters: SQL[] = [];
  if (scope === "church" || scope === "platform") filters.push(eq(assistantConversation.scope, scope));
  const search = q.trim().slice(0, 80);
  if (search) filters.push(ilike(church.name, `%${search.replace(/[%_\\]/g, "\\$&")}%`));
  if (scope === "platform") filters.push(isNull(assistantConversation.churchId));

  const rows = await db
    .select({
      id: assistantConversation.id,
      scope: assistantConversation.scope,
      messageCount: assistantConversation.messageCount,
      lastMessageAt: assistantConversation.lastMessageAt,
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

  // The kinds used per conversation: one grouped aggregate, joined in JS.
  const ids = visible.map((r) => r.id);
  const kinds = ids.length
    ? await db
        .select({
          conversationId: assistantMessage.conversationId,
          kind: assistantMessage.answerKind,
          n: count(),
        })
        .from(assistantMessage)
        .where(and(inArray(assistantMessage.conversationId, ids), eq(assistantMessage.role, "assistant")))
        .groupBy(assistantMessage.conversationId, assistantMessage.answerKind)
    : [];

  const list: TranscriptRow[] = visible.map((r) => ({
    id: r.id,
    churchName: r.scope === "platform" ? "Platform" : (r.churchName ?? "Deleted church"),
    scope: r.scope,
    messageCount: r.messageCount,
    lastMessageAt: r.lastMessageAt.toISOString(),
    locale: r.locale,
    kinds: kinds
      .filter((k) => k.conversationId === r.id && k.kind)
      .map((k) => ({ kind: k.kind as string, n: Number(k.n) })),
  }));

  const base = `/superadmin/assistant?tab=transcripts&q=${encodeURIComponent(search)}&scope=${encodeURIComponent(scope)}`;
  return (
    <div className="space-y-3">
      <AssistantTranscripts rows={list} q={search} scope={scope} />
      <Pager page={page} hasMore={hasMore} base={base} />
    </div>
  );
}
