"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeAssistantHref } from "@/lib/assistant/shared";

/**
 * Renders a model-written answer.
 *
 * Markdown only, never HTML: there is deliberately no rehype-raw here (the
 * blog renderer has it, for the editor's <u> and <mark>; a model must not
 * get it). Links are same-site paths or plain text, so an answer cannot carry
 * a phishing link, and images render nothing, so it cannot load a tracker.
 */
export function AssistantAnswer({ children }: { children: string }) {
  return (
    <div className="space-y-2 break-words [&_code]:bg-background [&_code]:rounded [&_code]:px-1 [&_li]:mb-0.5 [&_ol]:list-decimal [&_ol]:space-y-0.5 [&_ol]:pl-5 [&_strong]:font-semibold [&_table]:w-full [&_table]:text-xs [&_td]:border [&_td]:p-1 [&_th]:border [&_th]:p-1 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: label }) => {
            const safe = safeAssistantHref(href);
            return safe ? (
              <Link href={safe} className="text-primary font-medium underline">
                {label}
              </Link>
            ) : (
              <span>{label}</span>
            );
          },
          img: () => null,
          h1: ({ children: c }) => <p className="font-bold">{c}</p>,
          h2: ({ children: c }) => <p className="font-bold">{c}</p>,
          h3: ({ children: c }) => <p className="font-semibold">{c}</p>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
