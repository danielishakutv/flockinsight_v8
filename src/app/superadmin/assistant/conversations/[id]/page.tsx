import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db";
import { assistantConversation, assistantMessage, church } from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import { guideTitle } from "@/lib/assistant/grounding";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Assistant conversation · Admin" };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  answered: "Answered",
  not_in_guides: "Not in the guides",
  out_of_scope: "Out of scope",
  refused: "Declined",
  truncated: "Cut off",
  failed: "Failed",
};

function sourceLabel(ref: string): string {
  if (ref === "facts") return "The figures";
  if (ref.startsWith("guide:")) return guideTitle(ref.slice(6)) ?? ref;
  return "Approved answer";
}

/**
 * One conversation, read-only: what was asked (as stored, already scrubbed),
 * what was answered and in which mode, the sources, the figure check, the
 * verdict and the tokens. The asker is not named; the church is, because the
 * queue is worked per church.
 */
export default async function AssistantConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatform("platform.assistant.review");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const [conv] = await db
    .select({
      id: assistantConversation.id,
      scope: assistantConversation.scope,
      title: assistantConversation.title,
      locale: assistantConversation.locale,
      startedAt: assistantConversation.startedAt,
      lastMessageAt: assistantConversation.lastMessageAt,
      deletedAt: assistantConversation.deletedAt,
      contextChurchId: assistantConversation.contextChurchId,
      churchName: church.name,
    })
    .from(assistantConversation)
    .leftJoin(church, eq(church.id, assistantConversation.churchId))
    .where(eq(assistantConversation.id, id))
    .limit(1);
  if (!conv) notFound();

  const [rows, [context]] = await Promise.all([
    db
      .select({
        id: assistantMessage.id,
        role: assistantMessage.role,
        content: assistantMessage.content,
        redactions: assistantMessage.redactions,
        answerKind: assistantMessage.answerKind,
        sources: assistantMessage.sources,
        helpful: assistantMessage.helpful,
        reviewStatus: assistantMessage.reviewStatus,
        mode: assistantMessage.mode,
        figuresOk: assistantMessage.figuresOk,
        savedAt: assistantMessage.savedAt,
        inputTokens: assistantMessage.inputTokens,
        outputTokens: assistantMessage.outputTokens,
        createdAt: assistantMessage.createdAt,
      })
      .from(assistantMessage)
      .where(eq(assistantMessage.conversationId, conv.id))
      // Question before answer within an exchange (both carry one now()).
      .orderBy(asc(assistantMessage.createdAt), desc(assistantMessage.role)),
    conv.contextChurchId
      ? db.select({ name: church.name }).from(church).where(eq(church.id, conv.contextChurchId)).limit(1)
      : Promise.resolve([] as { name: string }[]),
  ]);

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/superadmin/assistant?tab=transcripts">
          <ArrowLeft className="size-4" /> Transcripts
        </Link>
      </Button>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {conv.scope === "platform" ? "Platform" : (conv.churchName ?? "Deleted church")}
          {conv.contextChurchId && (
            <span className="text-muted-foreground text-base font-normal">
              {" "}
              · acting as {context?.name ?? "a deleted church"}
            </span>
          )}
        </h1>
        {conv.title && <p className="mt-1 text-sm font-medium">{conv.title}</p>}
        <p className="text-muted-foreground mt-1 text-sm">
          {conv.locale} · started {conv.startedAt.toLocaleString()} · last {conv.lastMessageAt.toLocaleString()}
        </p>
        {conv.deletedAt && (
          <p className="bg-muted text-muted-foreground mt-2 rounded-xl px-3 py-2 text-sm">
            The person deleted this conversation on {conv.deletedAt.toLocaleString()}. It is hidden from them and
            is removed for good within 30 days, along with the AI ledger&apos;s copy of what its questions sent.
          </p>
        )}
      </div>

      <div className="space-y-3">
        {rows.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="bg-primary/5 rounded-2xl border p-3">
              <p className="text-muted-foreground text-xs font-semibold">
                Question{m.redactions > 0 ? ` · ${m.redactions} detail${m.redactions === 1 ? "" : "s"} removed` : ""}
              </p>
              <p className="mt-1 text-sm break-words whitespace-pre-wrap">{m.content}</p>
            </div>
          ) : (
            <div key={m.id} className="bg-card space-y-2 rounded-2xl border p-3 shadow-sm">
              <p className="text-muted-foreground flex flex-wrap gap-x-2 text-xs font-semibold">
                <span
                  className={
                    m.mode === "advisor" ? "text-violet-700 dark:text-violet-300" : undefined
                  }
                >
                  {m.mode === "advisor" ? "Advisor" : "Help"}
                </span>
                <span>· {KIND_LABEL[m.answerKind ?? ""] ?? m.answerKind}</span>
                <span>· review: {m.reviewStatus}</span>
                <span>
                  · helpful: {m.helpful === null ? "no answer" : m.helpful ? "yes" : "no"}
                </span>
                {m.savedAt && <span>· saved</span>}
                {m.inputTokens !== null && (
                  <span>
                    · {m.inputTokens} in / {m.outputTokens ?? 0} out tokens
                  </span>
                )}
              </p>
              {m.figuresOk === false && (
                <p className="rounded-lg bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-700 dark:text-rose-300">
                  Figures not in the data: at least one number in this answer was not found in the figures the model
                  was given. Whoever asked saw a note saying so under the answer.
                </p>
              )}
              <p className="text-sm break-words whitespace-pre-wrap">{m.content}</p>
              {(m.sources ?? []).length > 0 && (
                <p className="text-muted-foreground text-xs">
                  Sources: {(m.sources ?? []).map(sourceLabel).join(", ")}
                </p>
              )}
            </div>
          ),
        )}
        {rows.length === 0 && (
          <p className="text-muted-foreground text-sm">This conversation has no messages.</p>
        )}
      </div>
    </div>
  );
}
