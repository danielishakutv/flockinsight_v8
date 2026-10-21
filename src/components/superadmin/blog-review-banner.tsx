"use client";

import { useMemo } from "react";
import { AlertTriangle, Bot, CheckCircle2, OctagonX } from "lucide-react";
import { draftFlags } from "@/lib/blog-draft-checks";

/**
 * Shown above the editor for an AI-drafted post: when and why it was drafted,
 * that nothing is public yet, and the live checks, recomputed as the body
 * changes. A blocking flag also stops the server from publishing; a warning
 * is for the reviewer's judgement.
 */
export function BlogReviewBanner({
  aiDraftedAt,
  reviewedAt,
  topic,
  title,
  body,
  baseUrl,
}: {
  aiDraftedAt: string | null;
  reviewedAt: string | null;
  topic: { question: string; primary: string; canonicalPath: string } | null;
  title: string;
  body: string;
  baseUrl: string;
}) {
  const flags = useMemo(() => draftFlags({ title, body }, topic), [title, body, topic]);
  const drafted = aiDraftedAt ? new Date(aiDraftedAt).toLocaleDateString() : "an unknown date";

  return (
    <div className="space-y-2 rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4 text-sm">
      <p className="flex items-start gap-2">
        <Bot className="mt-0.5 size-4 shrink-0 text-violet-600 dark:text-violet-400" />
        <span>
          Drafted by AI on {drafted}
          {topic ? <> to answer &lsquo;{topic.question}&rsquo;</> : null}.{" "}
          {reviewedAt
            ? `Read and published on ${new Date(reviewedAt).toLocaleDateString()}.`
            : "Nothing here is public until you publish it."}
          {topic && (
            <>
              {" "}
              It should link{" "}
              <a
                href={`${baseUrl}${topic.canonicalPath}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary font-medium underline"
              >
                {topic.canonicalPath}
              </a>
              , the page that owns &ldquo;{topic.primary}&rdquo;.
            </>
          )}
        </span>
      </p>
      {flags.blocking.length === 0 && flags.warnings.length === 0 ? (
        <p className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-4" /> No forbidden claims, prices or missing links found. Still
          check every claim against the product.
        </p>
      ) : (
        <ul className="space-y-1">
          {flags.blocking.map((f) => (
            <li key={f.message} className="flex items-start gap-2 text-rose-700 dark:text-rose-300">
              <OctagonX className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong>Blocks publishing:</strong> {f.message}
              </span>
            </li>
          ))}
          {flags.warnings.map((f) => (
            <li key={f.message} className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{f.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
