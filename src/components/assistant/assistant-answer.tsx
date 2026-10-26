"use client";

import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeAssistantHref } from "@/lib/assistant/shared";

/*
 * The element for each piece of an answer. The advisor writes short sections
 * ("What the numbers show", "Recommendations") and the odd table, so headings
 * are real headings at a level below the chat's own title, and a table scrolls
 * inside its own box: a wide one must never push the page sideways on a phone.
 */
const BLOCKS: Components = {
  img: () => null,
  h1: ({ children: c }) => <h3 className="pt-1 text-base font-bold">{c}</h3>,
  h2: ({ children: c }) => <h3 className="pt-1 text-base font-bold">{c}</h3>,
  h3: ({ children: c }) => <h4 className="pt-0.5 font-semibold">{c}</h4>,
  h4: ({ children: c }) => <p className="font-semibold">{c}</p>,
  h5: ({ children: c }) => <p className="font-semibold">{c}</p>,
  h6: ({ children: c }) => <p className="font-semibold">{c}</p>,
  table: ({ children: c }) => (
    <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-lg border">
      <table className="w-full border-collapse text-xs sm:text-sm">{c}</table>
    </div>
  ),
  thead: ({ children: c }) => <thead className="bg-muted/70">{c}</thead>,
  th: ({ children: c, style }) => (
    <th style={style} className="border-b px-2 py-1.5 text-left font-semibold whitespace-nowrap">
      {c}
    </th>
  ),
  td: ({ children: c, style }) => (
    <td style={style} className="border-t px-2 py-1.5 align-top">
      {c}
    </td>
  ),
  pre: ({ children: c }) => <pre className="bg-background overflow-x-auto rounded-lg p-2 text-xs">{c}</pre>,
  blockquote: ({ children: c }) => <blockquote className="border-l-2 pl-3 text-muted-foreground">{c}</blockquote>,
  hr: () => <hr className="border-border" />,
};

/** A safe path as a link the reader can follow. */
const LINKED: Components = {
  ...BLOCKS,
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
};

/*
 * A safe path written out after its words instead, the way the PDF and the
 * Markdown download write it: for a reader who cannot open it here (a
 * superadmin with no church seat is sent from /help/... back to /superadmin),
 * a link would only take them out of the chat.
 */
const UNLINKED: Components = {
  ...BLOCKS,
  a: ({ href, children: label }) => {
    const safe = safeAssistantHref(href);
    return safe ? (
      <span>
        {label} <span className="text-muted-foreground">({safe})</span>
      </span>
    ) : (
      <span>{label}</span>
    );
  },
};

/**
 * Renders a model-written answer.
 *
 * Markdown only, never HTML: there is deliberately no rehype-raw here (the
 * blog renderer has it, for the editor's <u> and <mark>; a model must not
 * get it), so any HTML in an answer is dropped rather than drawn. Links are
 * same-site paths or plain text, so an answer cannot carry a phishing link,
 * and images render nothing, so it cannot load a tracker.
 *
 * `linkable` false writes each path out as text instead of linking it: the
 * same rule the source chips follow in the superadmin shell.
 */
export function AssistantAnswer({ children, linkable = true }: { children: string; linkable?: boolean }) {
  return (
    <div className="min-w-0 space-y-2 break-words [&_code]:bg-background [&_code]:rounded [&_code]:px-1 [&_li]:mb-0.5 [&_ol]:list-decimal [&_ol]:space-y-0.5 [&_ol]:pl-5 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:space-y-0.5 [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={linkable ? LINKED : UNLINKED} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
