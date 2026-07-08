"use client";

import { useRef, useState, type RefObject } from "react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Pilcrow,
  Quote,
  Underline,
} from "lucide-react";
import { toast } from "sonner";
import { uploadBlogImage } from "@/components/superadmin/blog-upload";

/**
 * A formatting toolbar for a Markdown <textarea>. Each button rewrites the
 * textarea value around the current selection, then restores the caret so the
 * author can keep typing. Underline/highlight are emitted as the safe inline
 * HTML tags the renderer allow-lists (`<u>`, `<mark>`).
 */
export function MarkdownToolbar({
  textareaRef,
  value,
  onChange,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  function restore(start: number, end: number) {
    const el = textareaRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, end);
    });
  }

  /** Wrap the selection with `before`/`after` (inserting a placeholder if empty). */
  function surround(before: string, after: string, placeholder: string) {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = value.slice(s, e) || placeholder;
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    onChange(next);
    const from = s + before.length;
    restore(from, from + sel.length);
  }

  /** Apply a per-line prefix transform to every line the selection touches. */
  function prefixLines(fn: (line: string, i: number) => string) {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const nextNl = value.indexOf("\n", e);
    const lineEnd = nextNl === -1 ? value.length : nextNl;
    const block = value.slice(lineStart, lineEnd);
    const transformed = block.split("\n").map(fn).join("\n");
    const next = value.slice(0, lineStart) + transformed + value.slice(lineEnd);
    onChange(next);
    restore(lineStart, lineStart + transformed.length);
  }

  const stripBlock = (l: string) =>
    l.replace(/^(#{1,6}\s+|>\s+|[-*]\s+|\d+\.\s+)/, "");

  function insertLink() {
    const el = textareaRef.current;
    if (!el) return;
    const url = window.prompt("Link URL", "https://");
    if (!url) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const label = value.slice(s, e) || "link text";
    const md = `[${label}](${url})`;
    onChange(value.slice(0, s) + md + value.slice(e));
    const from = s + 1;
    restore(from, from + label.length);
  }

  async function onPickImage(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadBlogImage(file, 1600);
      const el = textareaRef.current;
      const at = el ? el.selectionStart : value.length;
      const alt = file.name.replace(/\.[^.]+$/, "");
      const md = `\n\n![${alt}](${url})\n\n`;
      onChange(value.slice(0, at) + md + value.slice(at));
      restore(at + md.length, at + md.length);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const btn =
    "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50";
  const sep = <span className="bg-border mx-0.5 h-5 w-px" aria-hidden />;

  return (
    <div className="bg-muted/40 flex flex-wrap items-center gap-0.5 rounded-lg border p-1">
      <button type="button" className={btn} title="Heading 1"
        onClick={() => prefixLines((l) => `# ${stripBlock(l)}`)}>
        <Heading1 className="size-4" />
      </button>
      <button type="button" className={btn} title="Heading 2"
        onClick={() => prefixLines((l) => `## ${stripBlock(l)}`)}>
        <Heading2 className="size-4" />
      </button>
      <button type="button" className={btn} title="Heading 3"
        onClick={() => prefixLines((l) => `### ${stripBlock(l)}`)}>
        <Heading3 className="size-4" />
      </button>
      <button type="button" className={btn} title="Paragraph (clear formatting)"
        onClick={() => prefixLines((l) => stripBlock(l))}>
        <Pilcrow className="size-4" />
      </button>
      {sep}
      <button type="button" className={btn} title="Bold"
        onClick={() => surround("**", "**", "bold text")}>
        <Bold className="size-4" />
      </button>
      <button type="button" className={btn} title="Italic"
        onClick={() => surround("*", "*", "italic text")}>
        <Italic className="size-4" />
      </button>
      <button type="button" className={btn} title="Underline"
        onClick={() => surround("<u>", "</u>", "underlined text")}>
        <Underline className="size-4" />
      </button>
      <button type="button" className={btn} title="Highlight"
        onClick={() => surround("<mark>", "</mark>", "highlighted text")}>
        <Highlighter className="size-4" />
      </button>
      <button type="button" className={btn} title="Inline code"
        onClick={() => surround("`", "`", "code")}>
        <Code className="size-4" />
      </button>
      {sep}
      <button type="button" className={btn} title="Bulleted list"
        onClick={() => prefixLines((l) => `- ${stripBlock(l)}`)}>
        <List className="size-4" />
      </button>
      <button type="button" className={btn} title="Numbered list"
        onClick={() => prefixLines((l, i) => `${i + 1}. ${stripBlock(l)}`)}>
        <ListOrdered className="size-4" />
      </button>
      <button type="button" className={btn} title="Quote"
        onClick={() => prefixLines((l) => `> ${stripBlock(l)}`)}>
        <Quote className="size-4" />
      </button>
      {sep}
      <button type="button" className={btn} title="Insert link" onClick={insertLink}>
        <Link2 className="size-4" />
      </button>
      <button type="button" className={btn} title="Insert image"
        disabled={uploading} onClick={() => fileRef.current?.click()}>
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => onPickImage(e.target.files?.[0])}
      />
    </div>
  );
}
