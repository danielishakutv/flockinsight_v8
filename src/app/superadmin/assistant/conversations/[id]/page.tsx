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
  refused: "Declined",
  truncated: "Cut off",
  failed: "Failed",
};

/**
 * One conversation, read-only: what was asked (as stored, already scrubbed),
 * what was answered, the sources, the verdict and the tokens. The asker is not
 * named; the church is, because the queue is worked per church.
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
      locale: assistantConversation.locale,
      startedAt: assistantConversation.startedAt,
      lastMessageAt: assistantConversation.lastMessageAt,
      churchName: church.name,
    })
    .from(assistantConversation)
    .leftJoin(church, eq(church.id, assistantConversation.churchId))
    .where(eq(assistantConversation.id, id))
    .limit(1);
  if (!conv) notFound();

  const rows = await db
    .select({
      id: assistantMessage.id,
      role: assistantMessage.role,
      content: assistantMessage.content,
      redactions: assistantMessage.redactions,
      answerKind: assistantMessage.answerKind,
      sources: assistantMessage.sources,
      helpful: assistantMessage.helpful,
      reviewStatus: assistantMessage.reviewStatus,
      inputTokens: assistantMessage.inputTokens,
      outputTokens: assistantMessage.outputTokens,
      createdAt: assistantMessage.createdAt,
    })
    .from(assistantMessage)
    .where(eq(assistantMessage.conversationId, conv.id))
    // Question before answer within an exchange (both carry one now()).
    .orderBy(asc(assistantMessage.createdAt), desc(assistantMessage.role));

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
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {conv.locale} · started {conv.startedAt.toLocaleString()} · last{" "}
          {conv.lastMessageAt.toLocaleString()}
        </p>
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
                <span>{KIND_LABEL[m.answerKind ?? ""] ?? m.answerKind}</span>
                <span>· review: {m.reviewStatus}</span>
                <span>
                  · helpful: {m.helpful === null ? "no answer" : m.helpful ? "yes" : "no"}
                </span>
                {m.inputTokens !== null && (
                  <span>
                    · {m.inputTokens} in / {m.outputTokens ?? 0} out tokens
                  </span>
                )}
              </p>
              <p className="text-sm break-words whitespace-pre-wrap">{m.content}</p>
              {(m.sources ?? []).length > 0 && (
                <p className="text-muted-foreground text-xs">
                  Sources:{" "}
                  {(m.sources ?? [])
                    .map((s) =>
                      s.startsWith("guide:") ? (guideTitle(s.slice(6)) ?? s) : "Approved answer",
                    )
                    .join(", ")}
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
