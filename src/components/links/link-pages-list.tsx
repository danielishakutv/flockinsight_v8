"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  LayoutList,
  Loader2,
  Lock,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { createLinkPage, suggestLinkPageSlug } from "@/app/(app)/links/page-actions";
import {
  TITLE_MAX,
  linkPageUrl,
  linkPageUrlForPrint,
  normalisePageSlug,
  pageSlugProblem,
} from "@/lib/link-page-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The link pages a church has, on the Links & QR screen.
 *
 * Sits with the shortener and the codes rather than on a page of its own,
 * because a church arrives at this screen with one intention — "give people
 * somewhere to go" — and which of the three answers it needs is not a thing to
 * make it choose from a menu first.
 */

export type ListPage = {
  id: string;
  slug: string;
  title: string;
  status: string;
  viewCount: number;
  itemCount: number;
};

export function LinkPagesList({
  pages,
  baseUrl,
  canManage,
  locked = false,
  lockedMessage,
}: {
  pages: ListPage[];
  baseUrl: string;
  canManage: boolean;
  locked?: boolean;
  lockedMessage?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <LayoutList className="text-muted-foreground size-5" />
            Link pages
          </h2>
          <p className="text-muted-foreground text-sm">
            One address for all your links — the one to put in your bio.
          </p>
        </div>
        {canManage && !locked && (
          <Button type="button" className="min-h-11" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            New link page
          </Button>
        )}
      </div>

      {locked ? (
        <div className="bg-muted/40 flex items-start gap-3 rounded-2xl border border-dashed p-5">
          <Lock className="text-muted-foreground mt-0.5 size-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Link pages are on Growth</p>
            {/*
              `wrap-anywhere`: the plan copy carries a bare address
              (flockinsight.com/hub/yourchurch), which is one unbreakable word
              as far as CSS is concerned and runs off the right edge of a 320px
              phone. The audit script flags exactly this shape.
            */}
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed wrap-anywhere">
              {lockedMessage ??
                "One address that holds all your links, with your own pages on it."}
            </p>
          </div>
        </div>
      ) : pages.length === 0 ? (
        <p className="text-muted-foreground rounded-2xl border border-dashed p-6 text-center text-sm leading-relaxed">
          No link pages yet. Make one, drop your giving page and this
          Sunday&apos;s form onto it from a list, and you have a single address
          to hand out.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {pages.map((p) => (
            <Row key={p.id} page={p} baseUrl={baseUrl} />
          ))}
        </ul>
      )}

      <NewPageDialog open={open} onOpenChange={setOpen} />
    </section>
  );
}

function Row({ page, baseUrl }: { page: ListPage; baseUrl: string }) {
  const [copied, setCopied] = useState(false);
  const url = linkPageUrl(baseUrl, page.slug);
  const published = page.status === "published";

  return (
    <li className="bg-card rounded-2xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/links/pages/${page.id}`} className="min-w-0 flex-1 group">
          <p className="group-hover:text-primary truncate font-bold">
            {page.title}
          </p>
          <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
            {linkPageUrlForPrint(baseUrl, page.slug)}
          </p>
        </Link>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
            published
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {published ? "Live" : "Draft"}
        </span>
      </div>

      <div className="text-muted-foreground mt-3 flex items-center gap-4 text-xs">
        <span>
          {page.itemCount} {page.itemCount === 1 ? "link" : "links"}
        </span>
        <span className="inline-flex items-center gap-1">
          <Eye className="size-3.5" />
          {page.viewCount.toLocaleString()}
        </span>
      </div>

      <div className="mt-3 flex gap-2 border-t pt-3">
        <Button asChild variant="outline" size="sm" className="flex-1">
          <Link href={`/links/pages/${page.id}`}>Edit</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            } catch {
              toast.error("Could not copy. Open the page and copy it there.");
            }
          }}
          aria-label={`Copy the address for ${page.title}`}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        {published && (
          <Button asChild variant="outline" size="sm">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${page.title}`}
            >
              <ExternalLink className="size-4" />
            </a>
          </Button>
        )}
      </div>
    </li>
  );
}

function NewPageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [pending, startTransition] = useTransition();
  const [suggesting, startSuggest] = useTransition();

  function suggest() {
    startSuggest(async () => {
      const res = await suggestLinkPageSlug(title || "links");
      if (res) setSlug(res.slug);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setTitle("");
          setSlug("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New link page</DialogTitle>
          <DialogDescription>
            It starts as a draft, so nothing is public until you say so.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="np-title">Title</Label>
            <Input
              id="np-title"
              value={title}
              maxLength={TITLE_MAX}
              placeholder="Grace Chapel"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="np-slug">Address (optional)</Label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                /hub/
              </span>
              <Input
                id="np-slug"
                value={slug}
                placeholder="grace"
                className="font-mono"
                onChange={(e) => setSlug(normalisePageSlug(e.target.value))}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={suggest}
                disabled={suggesting}
              >
                {suggesting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Suggest"
                )}
              </Button>
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              Leave it blank and we will make one from the title.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                // Only checked when something was typed: an empty one is
                // suggested from the title on the server, deliberately.
                if (slug) {
                  const problem = pageSlugProblem(slug);
                  if (problem) {
                    toast.error(problem);
                    return;
                  }
                }
                const res = await createLinkPage({ title, slug });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                onOpenChange(false);
                // Straight into the editor, which is where the next thing
                // they want to do is.
                if (res.id) router.push(`/links/pages/${res.id}`);
              })
            }
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
