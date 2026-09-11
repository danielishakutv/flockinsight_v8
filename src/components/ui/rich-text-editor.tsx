"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A small formatting editor for notification bodies.
 *
 * Deliberately built on contentEditable rather than a framework editor: this
 * needs bold, italic, underline, a link and two kinds of list, and pulling in
 * ProseMirror for that would cost more than the whole admin bundle. The output
 * is re-parsed and rebuilt from an allowlist on the server (`rich-text.ts`),
 * so whatever a browser's execCommand produces — and they each produce
 * something slightly different — only the tags we allow survive the trip.
 *
 * Uncontrolled on purpose. Writing every keystroke back into the DOM through
 * React moves the caret to the end of the line, which makes the editor
 * unusable for anything longer than a sentence.
 */

type Cmd = {
  key: string;
  label: string;
  icon: typeof Bold;
  command: string;
  arg?: string;
};

const COMMANDS: Cmd[] = [
  { key: "bold", label: "Bold", icon: Bold, command: "bold" },
  { key: "italic", label: "Italic", icon: Italic, command: "italic" },
  { key: "underline", label: "Underline", icon: Underline, command: "underline" },
  {
    key: "strikeThrough",
    label: "Strikethrough",
    icon: Strikethrough,
    command: "strikeThrough",
  },
  {
    key: "insertUnorderedList",
    label: "Bulleted list",
    icon: List,
    command: "insertUnorderedList",
  },
  {
    key: "insertOrderedList",
    label: "Numbered list",
    icon: ListOrdered,
    command: "insertOrderedList",
  },
  {
    key: "formatBlock",
    label: "Quote",
    icon: Quote,
    command: "formatBlock",
    arg: "blockquote",
  },
];

export function RichTextEditor({
  value,
  onChange,
  onPlainChange,
  placeholder,
  className,
  ariaLabel = "Message",
}: {
  value: string;
  onChange: (html: string) => void;
  /** The visible text, for a character count that ignores markup. */
  onPlainChange?: (plain: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [empty, setEmpty] = useState(true);

  /*
   * Push `value` in only when it differs from what is already rendered.
   * Anything else fights the caret on every keystroke; this way the prop still
   * works for loading a draft or reusing a sent notice, which is the only time
   * it changes from outside.
   *
   * `value` MUST already be sanitised. Assigning innerHTML does not run a
   * <script>, but it very much does run an inline handler like
   * `<img onerror=...>`, so anything arriving from the database is put through
   * sanitizeRichText() in the server component that builds the prefill. The
   * caller owns that; this line trusts it.
   */
  useEffect(() => {
    const el = ref.current;
    if (el && value !== el.innerHTML) {
      el.innerHTML = value;
      setEmpty(!el.innerText.trim());
      // A draft loaded from outside still needs its length counted, or the
      // character count reads 0 until the first keystroke.
      onPlainChange?.(el.innerText);
    }
  }, [value, onPlainChange]);

  const publish = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    onChange(el.innerHTML);
    onPlainChange?.(el.innerText);
    setEmpty(!el.innerText.trim());
  }, [onChange, onPlainChange]);

  /** Which buttons should look pressed for the current selection. */
  const refreshActive = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const c of COMMANDS) {
      try {
        next[c.key] = c.arg ? false : document.queryCommandState(c.command);
      } catch {
        next[c.key] = false;
      }
    }
    setActive(next);
  }, []);

  useEffect(() => {
    const handler = () => {
      if (
        ref.current &&
        document.activeElement === ref.current
      ) {
        refreshActive();
      }
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [refreshActive]);

  function run(c: Cmd) {
    ref.current?.focus();
    // Semantic tags (<b>, <i>) rather than inline styles — they survive the
    // sanitiser, and email clients understand them everywhere.
    try {
      document.execCommand("styleWithCSS", false, "false");
    } catch {
      /* not supported everywhere; the sanitiser cleans up either way */
    }
    document.execCommand(c.command, false, c.arg);
    publish();
    refreshActive();
  }

  function addLink() {
    ref.current?.focus();
    const sel = window.getSelection();
    const selected = sel?.toString() ?? "";
    const url = window.prompt(
      selected
        ? `Link "${selected.slice(0, 40)}" to which address?`
        : "Paste the address to link to",
      "https://",
    );
    if (!url || url === "https://") return;
    if (!/^(https?:|mailto:|tel:)/i.test(url)) {
      window.alert("Use a full address starting with https://");
      return;
    }
    if (selected) {
      document.execCommand("createLink", false, url);
    } else {
      document.execCommand("insertHTML", false, `<a href="${url}">${url}</a>`);
    }
    publish();
  }

  function removeLink() {
    ref.current?.focus();
    document.execCommand("unlink");
    publish();
  }

  /*
   * Paste as plain text.
   *
   * Copying from a Word document or a web page drags in font tags, colours and
   * class names. The sanitiser would strip them server-side anyway, so the
   * editor would show one thing and the church receive another — worse than
   * simply not accepting them.
   */
  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    publish();
  }

  return (
    <div className={cn("rounded-xl border", className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b p-1.5">
        {COMMANDS.map((c) => (
          <ToolButton
            key={c.key}
            label={c.label}
            icon={c.icon}
            pressed={active[c.key]}
            onClick={() => run(c)}
          />
        ))}
        <span className="bg-border mx-1 h-5 w-px" aria-hidden />
        <ToolButton label="Add link" icon={Link2} onClick={addLink} />
        <ToolButton label="Remove link" icon={Link2Off} onClick={removeLink} />
      </div>

      <div className="relative">
        {empty && placeholder && (
          <p className="text-muted-foreground pointer-events-none absolute top-3 left-3 text-sm">
            {placeholder}
          </p>
        )}
        <div
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          contentEditable
          suppressContentEditableWarning
          onInput={publish}
          onBlur={publish}
          onPaste={onPaste}
          onKeyUp={refreshActive}
          onMouseUp={refreshActive}
          className="min-h-32 w-full px-3 py-3 text-sm leading-relaxed outline-none [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:italic [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
        />
      </div>
    </div>
  );
}

function ToolButton({
  label,
  icon: Icon,
  pressed,
  onClick,
}: {
  label: string;
  icon: typeof Bold;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed ?? false}
      // The editor must keep the selection: a button that steals focus first
      // applies the command to nothing.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "hover:bg-accent hover:text-accent-foreground inline-flex size-8 items-center justify-center rounded-md transition-colors",
        pressed && "bg-accent text-accent-foreground",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}
