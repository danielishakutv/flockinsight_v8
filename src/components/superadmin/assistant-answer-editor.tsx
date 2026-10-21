"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Copy, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  approveCannedAnswer,
  createCannedAnswer,
  retireCannedAnswer,
  saveCannedAnswer,
} from "@/app/superadmin/assistant/actions";
import { AssistantAnswer } from "@/components/assistant/assistant-answer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type CannedAnswerState = {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
  guideSlug: string | null;
  status: "draft" | "approved" | "retired";
  draftedByAi: boolean;
};

/** "New canned answer" on the Canned answers tab. */
export function NewCannedAnswerButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await createCannedAnswer();
          if (!res.ok) return void toast.error(res.error);
          router.push(`/superadmin/assistant/answers/${res.id}`);
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
      New canned answer
    </Button>
  );
}

/**
 * Edits one canned answer. Guide options arrive as props from the server page
 * (slug and title only), so GUIDES never reaches this bundle.
 */
export function AssistantAnswerEditor({
  answer,
  guides,
}: {
  answer: CannedAnswerState;
  guides: { slug: string; title: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState(answer);
  const [keyword, setKeyword] = useState("");
  const editable = f.status === "draft";
  const set = (patch: Partial<CannedAnswerState>) => setF((p) => ({ ...p, ...patch }));

  function save(then?: () => Promise<void>) {
    start(async () => {
      const res = await saveCannedAnswer({
        id: f.id,
        question: f.question,
        answer: f.answer,
        keywords: f.keywords,
        guideSlug: f.guideSlug,
      });
      if (!res.ok) return void toast.error(res.error);
      if (then) await then();
      else {
        toast.success("Draft saved");
        router.refresh();
      }
    });
  }

  function approve() {
    save(async () => {
      const res = await approveCannedAnswer({ id: f.id });
      if (!res.ok) return void toast.error(res.error);
      set({ status: "approved" });
      toast.success("Approved — every church's assistant can use it now");
      router.refresh();
    });
  }

  function retire() {
    start(async () => {
      const res = await retireCannedAnswer({ id: f.id });
      if (!res.ok) return void toast.error(res.error);
      set({ status: "retired" });
      toast.success("Retired");
      router.refresh();
    });
  }

  function addKeyword(raw: string) {
    const k = raw.trim().toLowerCase().slice(0, 40);
    if (!k || f.keywords.includes(k) || f.keywords.length >= 12) return;
    set({ keywords: [...f.keywords, k] });
  }

  function onKeywordKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addKeyword(keyword);
      setKeyword("");
    }
  }

  async function copyAsFaq() {
    const snippet = `{\n  q: ${JSON.stringify(f.question)},\n  a: ${JSON.stringify(f.answer)},\n},`;
    try {
      await navigator.clipboard.writeText(snippet);
      toast.success("Copied — paste it into the guide's faq array in lib/help");
    } catch (e) {
      console.error("[assistant-editor] clipboard refused", e);
      toast.error("Your browser refused the clipboard. Select the text and copy it by hand.");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/superadmin/assistant?tab=answers">
            <ArrowLeft className="size-4" /> Canned answers
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs font-semibold uppercase">{f.status}</span>
          <Button variant="outline" size="sm" onClick={copyAsFaq}>
            <Copy className="size-4" /> Copy as a guide FAQ entry
          </Button>
          {f.status !== "retired" && (
            <Button variant="outline" size="sm" onClick={retire} disabled={pending}>
              Retire
            </Button>
          )}
          {editable && (
            <>
              <Button variant="outline" onClick={() => save()} disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                Save draft
              </Button>
              <Button onClick={approve} disabled={pending}>
                <Check className="size-4" />
                Approve
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        Approved answers are shown to every church. Write it for anyone — no church names, people or
        numbers.
        {!editable && " Only drafts can be edited: retire this one and draft again to change it."}
        {f.draftedByAi && " The first version was drafted by AI; check every step against the product."}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-2">
              <Label htmlFor="q">Question</Label>
              <Input
                id="q"
                value={f.question}
                maxLength={300}
                disabled={!editable}
                onChange={(e) => set({ question: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="a">Answer (Markdown; links only as /paths)</Label>
              <Textarea
                id="a"
                rows={12}
                value={f.answer}
                maxLength={2000}
                disabled={!editable}
                onChange={(e) => set({ answer: e.target.value })}
              />
              <p className="text-muted-foreground text-xs">{f.answer.length} / 2000</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="kw">Keywords (up to 12)</Label>
              <div className="flex flex-wrap gap-1.5">
                {f.keywords.map((k) => (
                  <span
                    key={k}
                    className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs font-semibold"
                  >
                    {k}
                    {editable && (
                      <button
                        type="button"
                        aria-label={`Remove ${k}`}
                        onClick={() => set({ keywords: f.keywords.filter((x) => x !== k) })}
                        className="hover:bg-primary/20 grid size-4 place-items-center rounded-full"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {editable && (
                <Input
                  id="kw"
                  value={keyword}
                  placeholder="Type a keyword and press Enter"
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={onKeywordKey}
                  onBlur={() => {
                    addKeyword(keyword);
                    setKeyword("");
                  }}
                />
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="guide">Belongs in guide (for a permanent FAQ entry)</Label>
              <select
                id="guide"
                value={f.guideSlug ?? ""}
                disabled={!editable}
                onChange={(e) => set({ guideSlug: e.target.value || null })}
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              >
                <option value="">No guide yet</option>
                {guides.map((g) => (
                  <option key={g.slug} value={g.slug}>
                    {g.title}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-muted-foreground text-xs font-semibold">Preview, as the assistant renders it</p>
            <p className="font-semibold">{f.question || "—"}</p>
            <div className="bg-muted/60 rounded-2xl p-3 text-sm">
              {f.answer.trim() ? (
                <AssistantAnswer>{f.answer}</AssistantAnswer>
              ) : (
                <p className="text-muted-foreground">Write the answer to see it here.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
