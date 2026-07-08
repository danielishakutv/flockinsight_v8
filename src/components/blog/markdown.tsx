"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

/**
 * Sanitisation schema: react-markdown normally strips raw HTML, but the blog
 * editor emits a little inline HTML for formatting Markdown can't express —
 * `<u>` (underline) and `<mark>` (highlight). We enable `rehype-raw` so HTML is
 * parsed, then `rehype-sanitize` (GitHub's safe defaults) strips
 * scripts/handlers/etc. We only extend the allow-list with those inline tags.
 * Everything dangerous (script, iframe, on* attributes, javascript: URLs) stays
 * blocked.
 */
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "u", "mark", "ins"],
};

/**
 * Renders Markdown safely. Raw HTML is parsed but sanitised (see `schema`), so
 * only a small, safe set of inline tags survives. Styled inline so we don't
 * depend on the typography plugin.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div
      className={[
        "max-w-none text-[15px] leading-relaxed",
        "[&_h1]:mt-8 [&_h1]:mb-4 [&_h1]:text-3xl [&_h1]:font-extrabold [&_h1]:tracking-tight",
        "[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:font-extrabold [&_h2]:tracking-tight",
        "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-xl [&_h3]:font-bold",
        "[&_p]:mb-4 [&_p]:text-foreground/90",
        "[&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6",
        "[&_li]:mb-1",
        "[&_a]:text-primary [&_a]:font-medium [&_a]:underline",
        "[&_u]:underline [&_u]:decoration-2 [&_u]:underline-offset-2",
        "[&_mark]:bg-primary/20 [&_mark]:text-foreground [&_mark]:rounded [&_mark]:px-1",
        "[&_blockquote]:border-primary/40 [&_blockquote]:text-muted-foreground [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_blockquote]:italic",
        "[&_code]:bg-muted [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm",
        "[&_pre]:bg-muted [&_pre]:mb-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:p-4",
        "[&_img]:my-4 [&_img]:rounded-xl [&_img]:border",
        "[&_hr]:my-8 [&_hr]:border-t",
        "[&_table]:mb-4 [&_table]:w-full [&_th]:border [&_th]:p-2 [&_th]:text-left [&_td]:border [&_td]:p-2",
      ].join(" ")}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
