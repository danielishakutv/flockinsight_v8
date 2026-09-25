"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Images, Loader2, StickyNote, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_TRANSLATION,
  parseReference,
  QUICK_VERSES,
  suggestBooks,
  TRANSLATIONS,
} from "@/lib/scripture-shared";
import { cn } from "@/lib/utils";

type Tab = "verse" | "slides" | "note";
type LibraryItem = { id: string; title: string; url: string };

/**
 * What a host can put on everyone's screen.
 *
 * Three things, because these are the three that come up: a verse, a set of
 * slides, and a line of text (a hymn number, an announcement, a name to pray
 * for). Anything more elaborate is what screen sharing is for.
 */
export function SharePanel({
  code,
  peerId,
  secret,
  busy,
  onVerse,
  onNote,
  onSlides,
  onClear,
  hasStage,
}: {
  code: string;
  peerId: string;
  secret: string;
  busy: boolean;
  onVerse: (input: { reference: string; translation: string; text?: string }) => void;
  onNote: (input: { title: string; body: string }) => void;
  onSlides: (ids: string[]) => void;
  onClear: () => void;
  hasStage: boolean;
}) {
  const [tab, setTab] = useState<Tab>("verse");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 border-b border-white/10 p-2">
        <TabButton active={tab === "verse"} onClick={() => setTab("verse")}>
          <BookOpen className="size-4" /> Verse
        </TabButton>
        <TabButton active={tab === "slides"} onClick={() => setTab("slides")}>
          <Images className="size-4" /> Slides
        </TabButton>
        <TabButton active={tab === "note"} onClick={() => setTab("note")}>
          <StickyNote className="size-4" /> Note
        </TabButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "verse" && <VerseTab busy={busy} onVerse={onVerse} />}
        {tab === "slides" && (
          <SlidesTab code={code} peerId={peerId} secret={secret} busy={busy} onSlides={onSlides} />
        )}
        {tab === "note" && <NoteTab busy={busy} onNote={onNote} />}
      </div>

      {hasStage && (
        <div className="border-t border-white/10 p-3">
          <Button variant="secondary" size="sm" className="w-full" onClick={onClear}>
            <X className="size-4" /> Clear the screen
          </Button>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition",
        active ? "bg-white/15 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

/* ============================================================
 * Verse
 * ========================================================== */

function VerseTab({
  busy,
  onVerse,
}: {
  busy: boolean;
  onVerse: (input: { reference: string; translation: string; text?: string }) => void;
}) {
  const [reference, setReference] = useState("");
  const [translation, setTranslation] = useState<string>(DEFAULT_TRANSLATION);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");

  // Validate before anything is sent, so a typo is caught here rather than
  // costing a round trip on a connection that may not have one to spare.
  const check = useMemo(
    () => (reference.trim() ? parseReference(reference) : null),
    [reference],
  );
  const books = useMemo(
    () => (reference.trim().length >= 2 && check && !check.ok ? suggestBooks(reference) : []),
    [reference, check],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pasting) {
      if (!pasted.trim()) return;
      onVerse({ reference: reference.trim() || "Scripture", translation, text: pasted.trim() });
      return;
    }
    if (!check?.ok) return;
    onVerse({ reference: check.ref.canonical, translation });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <Label htmlFor="verse-ref" className="mb-1.5 block text-slate-300">
          Reference
        </Label>
        <Input
          id="verse-ref"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="John 3:16"
          autoComplete="off"
          className="border-white/15 bg-white/5 text-white placeholder:text-slate-500"
        />
        {check && !check.ok && reference.trim().length > 2 && (
          <p className="mt-1 text-xs text-amber-400">{check.error}</p>
        )}
        {books.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {books.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setReference(`${b} `)}
                className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/20"
              >
                {b}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <Label className="mb-1.5 block text-slate-300">Translation</Label>
        <Select value={translation} onValueChange={setTranslation}>
          <SelectTrigger className="border-white/15 bg-white/5 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRANSLATIONS.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name} ({t.short})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {pasting && (
        <div>
          <Label htmlFor="verse-text" className="mb-1.5 block text-slate-300">
            The text
          </Label>
          <Textarea
            id="verse-text"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={5}
            placeholder="Paste or type the passage…"
            className="border-white/15 bg-white/5 text-white placeholder:text-slate-500"
          />
        </div>
      )}

      <Button type="submit" disabled={busy || (!pasting && !check?.ok)} className="w-full">
        {busy ? <Loader2 className="animate-spin" /> : <BookOpen className="size-4" />}
        Put it on the screen
      </Button>

      <button
        type="button"
        onClick={() => setPasting((v) => !v)}
        className="w-full text-center text-xs text-slate-400 underline-offset-2 hover:underline"
      >
        {pasting
          ? "Look the verse up instead"
          : "Use my own translation — type or paste the text"}
      </button>

      <div>
        <p className="mb-2 text-xs font-bold tracking-wide text-slate-400 uppercase">
          Often used
        </p>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_VERSES.map((v) => (
            <button
              key={v}
              type="button"
              disabled={busy}
              onClick={() => onVerse({ reference: v, translation })}
              className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/20 disabled:opacity-50"
            >
              {v}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}

/* ============================================================
 * Slides
 * ========================================================== */

function SlidesTab({
  code,
  peerId,
  secret,
  busy,
  onSlides,
}: {
  code: string;
  peerId: string;
  secret: string;
  busy: boolean;
  onSlides: (ids: string[]) => void;
}) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/meet/${code}/library?peer=${encodeURIComponent(peerId)}&secret=${encodeURIComponent(secret)}`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok) {
          setError(data.error ?? "We couldn't load your media library.");
          setItems([]);
          return;
        }
        setItems(data.items as LibraryItem[]);
      } catch {
        if (!cancelled) {
          setError("We couldn't load your media library.");
          setItems([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, peerId, secret]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  if (items === null) {
    return (
      <p className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
        <Loader2 className="size-4 animate-spin" /> Loading your images…
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-slate-400">
          {error ?? "There are no images in your media library yet."}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Upload slides under Media, then they&apos;ll appear here. Exported a
          deck as images? Those work.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        Tap in the order you want them shown.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {items.map((it) => {
          const at = picked.indexOf(it.id);
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => toggle(it.id)}
              className={cn(
                "relative aspect-video overflow-hidden rounded-lg ring-1 ring-white/10",
                at >= 0 && "ring-2 ring-indigo-400",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.url} alt={it.title} loading="lazy" className="size-full object-cover" />
              {at >= 0 && (
                <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-indigo-500 text-[11px] font-bold text-white">
                  {at + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <Button
        className="w-full"
        disabled={busy || picked.length === 0}
        onClick={() => onSlides(picked)}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Images className="size-4" />}
        Show {picked.length || ""} slide{picked.length === 1 ? "" : "s"}
      </Button>
    </div>
  );
}

/* ============================================================
 * Note
 * ========================================================== */

function NoteTab({
  busy,
  onNote,
}: {
  busy: boolean;
  onNote: (input: { title: string; body: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        onNote({ title: title.trim(), body: body.trim() });
      }}
      className="space-y-3"
    >
      <div>
        <Label htmlFor="note-title" className="mb-1.5 block text-slate-300">
          Heading <span className="text-slate-500">(optional)</span>
        </Label>
        <Input
          id="note-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={160}
          placeholder="Announcement"
          className="border-white/15 bg-white/5 text-white placeholder:text-slate-500"
        />
      </div>
      <div>
        <Label htmlFor="note-body" className="mb-1.5 block text-slate-300">
          What should everyone see?
        </Label>
        <Textarea
          id="note-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          maxLength={4000}
          placeholder={"Hymn 214\nGreat is Thy faithfulness"}
          className="border-white/15 bg-white/5 text-white placeholder:text-slate-500"
        />
      </div>
      <Button type="submit" className="w-full" disabled={busy || !body.trim()}>
        {busy ? <Loader2 className="animate-spin" /> : <StickyNote className="size-4" />}
        Put it on the screen
      </Button>
    </form>
  );
}
