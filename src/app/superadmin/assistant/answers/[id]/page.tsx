import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assistantAnswer } from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import { GUIDES } from "@/lib/help-guides";
import {
  AssistantAnswerEditor,
  type CannedAnswerState,
} from "@/components/superadmin/assistant-answer-editor";

export const metadata = { title: "Canned answer · Admin" };
export const dynamic = "force-dynamic";

export default async function CannedAnswerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatform("platform.assistant.review");
  const { id } = await params;
  // A malformed id is "not found": Postgres would reject the uuid cast outright.
  if (!z.string().uuid().safeParse(id).success) notFound();

  const [row] = await db
    .select({
      id: assistantAnswer.id,
      question: assistantAnswer.question,
      answer: assistantAnswer.answer,
      keywords: assistantAnswer.keywords,
      guideSlug: assistantAnswer.guideSlug,
      status: assistantAnswer.status,
      draftedByAi: assistantAnswer.draftedByAi,
    })
    .from(assistantAnswer)
    .where(eq(assistantAnswer.id, id))
    .limit(1);
  if (!row) notFound();

  const answer: CannedAnswerState = {
    ...row,
    keywords: row.keywords ?? [],
    status: row.status === "approved" || row.status === "retired" ? row.status : "draft",
  };

  return (
    <AssistantAnswerEditor
      answer={answer}
      guides={GUIDES.map((g) => ({ slug: g.slug, title: g.title }))}
    />
  );
}
