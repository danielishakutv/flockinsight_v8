"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Globe,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  addLinkItem,
  deleteLinkPage,
  moveLinkItem,
  removeLinkItem,
  setLinkPageStatus,
  updateLinkItem,
  updateLinkPage,
} from "@/app/(app)/links/page-actions";
import {
  DESCRIPTION_MAX,
  LINK_PAGE_LAYOUTS,
  LINK_PAGE_STYLES,
  MAX_ITEMS,
  TAGLINE_MAX,
  TITLE_MAX,
  getLinkPageStyle,
  linkPageUrl,
  linkPageUrlForPrint,
  normalisePageSlug,
  pageSlugProblem,
} from "@/lib/link-page-shared";
import { getTheme } from "@/lib/church-themes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LinkPageView } from "@/components/links/link-page-view";
import {
  InternalLinkPicker,
  type PickerLink,
} from "@/components/links/internal-link-picker";

/**
 * The editor.
 *
 * Laid out as settings on the left and the real page on the right, and the
 * preview is the actual `LinkPageView` with the actual props — not a drawing of
 * it. Every style the picker offers is rendered by the same component that
 * serves `/hub/<slug>`, so the preview cannot drift from the result.
 *
 * Saving is per field rather than one big Save button. A church fiddles with a
 * style, looks at it, changes the layout, looks again — and a form that loses
 * everything because somebody navigated away without pressing Save is the
 * commonest way a settings page betrays somebody. Style, layout and the two
 * switches save the moment they are touched; the text fields save on blur.
 */

export type EditorPage = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  status: string;
  style: string;
  layout: string;
  showLogo: boolean;
  showChurchName: boolean;
  viewCount: number;
};

export type EditorItem = {
  id: string;
  label: string;
  url: string;
  kind: string;
  description: string | null;
  position: number;
  isActive: boolean;
};

export function LinkPageEditor({
  page,
  items,
  internalLinks,
  baseUrl,
  churchName,
  churchLogo,
  churchTheme,
  canManage,
}: {
  page: EditorPage;
  items: EditorItem[];
  internalLinks: PickerLink[];
  baseUrl: string;
  churchName: string;
  churchLogo: string | null;
  churchTheme: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  /*
   * Local copies of the things that change on every click, so the preview
   * moves the instant a style is chosen rather than after the round trip.
   * The server is still the authority — `router.refresh()` reconciles.
   */
  const [style, setStyle] = useState(page.style);
  const [layout, setLayout] = useState(page.layout);
  const [showLogo, setShowLogo] = useState(page.showLogo);
  const [showChurchName, setShowChurchName] = useState(page.showChurchName);

  const [title, setTitle] = useState(page.title);
  const [tagline, setTagline] = useState(page.tagline ?? "");
  const [slug, setSlug] = useState(page.slug);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [externalOpen, setExternalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const published = page.status === "published";
  const url = linkPageUrl(baseUrl, page.slug);
  const full = items.length >= MAX_ITEMS;

  function save(patch: Parameters<typeof updateLinkPage>[0]) {
    startTransition(async () => {
      const res = await updateLinkPage(patch);
      if (!res.ok) {
        toast.error(res.error);
        /*
         * Put the fields back to what the server has.
         *
         * Without this, a rejected slug stays in the box looking saved — the
         * single most misleading state a settings form can be in.
         */
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard refused (an insecure context, or a browser that asks).
      // Saying so beats a button that silently does nothing.
      toast.error("Could not copy. Select the address and copy it by hand.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* ======================================================== left */}
      <div className="space-y-6">
        {/* ------------------------------------------- the address */}
        <section className="bg-card rounded-2xl border p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                Your address
              </p>
              <p className="mt-0.5 truncate font-mono text-sm font-semibold">
                {linkPageUrlForPrint(baseUrl, page.slug)}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="outline" size="sm" onClick={copy}>
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
              {published && (
                <Button asChild variant="outline" size="sm">
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" />
                    Open
                  </a>
                </Button>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
            <Button
              type="button"
              variant={published ? "outline" : "default"}
              disabled={!canManage || pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await setLinkPageStatus(
                    page.id,
                    published ? "draft" : "published",
                  );
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success(
                    published
                      ? "Taken down. The address now shows nothing."
                      : "Live. Anyone with the address can see it.",
                  );
                  router.refresh();
                })
              }
            >
              {published ? (
                <>
                  <EyeOff className="size-4" />
                  Take it down
                </>
              ) : (
                <>
                  <Globe className="size-4" />
                  Publish
                </>
              )}
            </Button>
            <p className="text-muted-foreground text-xs">
              {published
                ? `Live · opened ${page.viewCount.toLocaleString()} ${page.viewCount === 1 ? "time" : "times"}`
                : "Draft — the address shows nothing until you publish."}
            </p>
          </div>
        </section>

        {/* -------------------------------------------- the wording */}
        <section className="bg-card space-y-4 rounded-2xl border p-4 sm:p-5">
          <h2 className="font-bold">The page</h2>

          <div>
            <Label htmlFor="lp-title">Title</Label>
            <Input
              id="lp-title"
              value={title}
              maxLength={TITLE_MAX}
              disabled={!canManage}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title !== page.title && save({ id: page.id, title })}
            />
          </div>

          <div>
            <Label htmlFor="lp-tagline">A line underneath (optional)</Label>
            <Textarea
              id="lp-tagline"
              value={tagline}
              maxLength={TAGLINE_MAX}
              rows={2}
              disabled={!canManage}
              placeholder="Sundays 8am & 10am · Ikeja, Lagos"
              onChange={(e) => setTagline(e.target.value)}
              onBlur={() =>
                tagline !== (page.tagline ?? "") &&
                save({ id: page.id, tagline })
              }
            />
          </div>

          <div>
            <Label htmlFor="lp-slug">Address</Label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                /hub/
              </span>
              <Input
                id="lp-slug"
                value={slug}
                disabled={!canManage}
                onChange={(e) => setSlug(normalisePageSlug(e.target.value))}
                onBlur={() => {
                  if (slug === page.slug) return;
                  const problem = pageSlugProblem(slug);
                  if (problem) {
                    toast.error(problem);
                    setSlug(page.slug);
                    return;
                  }
                  save({ id: page.id, slug });
                }}
                className="font-mono"
              />
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              Changing this breaks the old address. Anywhere you have already
              pasted it will stop working.
            </p>
          </div>

          <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
            <Toggle
              id="lp-logo"
              label="Show our logo"
              checked={showLogo}
              disabled={!canManage}
              onChange={(v) => {
                setShowLogo(v);
                save({ id: page.id, showLogo: v });
              }}
            />
            <Toggle
              id="lp-name"
              label="Show our name"
              checked={showChurchName}
              disabled={!canManage}
              onChange={(v) => {
                setShowChurchName(v);
                save({ id: page.id, showChurchName: v });
              }}
            />
          </div>
        </section>

        {/* ---------------------------------------------- the style */}
        <section className="bg-card space-y-4 rounded-2xl border p-4 sm:p-5">
          <div>
            <h2 className="font-bold">Style</h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Your colours come from your church theme in Settings. A style
              decides how they are arranged.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {LINK_PAGE_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={!canManage}
                onClick={() => {
                  setStyle(s.id);
                  save({ id: page.id, style: s.id });
                }}
                aria-pressed={style === s.id}
                className={cn(
                  "rounded-xl border-2 p-2 text-left transition disabled:opacity-60",
                  style === s.id
                    ? "border-primary bg-primary/5"
                    : "hover:border-muted-foreground/40 border-transparent bg-muted/40",
                )}
              >
                <StyleSwatch styleId={s.id} churchTheme={churchTheme} />
                <p className="mt-1.5 text-xs font-bold">{s.name}</p>
                <p className="text-muted-foreground text-[11px] leading-snug">
                  {s.hint}
                </p>
              </button>
            ))}
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-bold">How the links show</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {LINK_PAGE_LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  disabled={!canManage}
                  onClick={() => {
                    setLayout(l.id);
                    save({ id: page.id, layout: l.id });
                  }}
                  aria-pressed={layout === l.id}
                  className={cn(
                    "rounded-xl border-2 px-3 py-2 text-left transition disabled:opacity-60",
                    layout === l.id
                      ? "border-primary bg-primary/5"
                      : "hover:border-muted-foreground/40 border-transparent bg-muted/40",
                  )}
                >
                  <p className="text-xs font-bold">{l.name}</p>
                  <p className="text-muted-foreground text-[11px] leading-snug">
                    {l.hint}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------- the links */}
        <section className="bg-card space-y-3 rounded-2xl border p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold">Links</h2>
              <p className="text-muted-foreground text-sm">
                {items.length} of {MAX_ITEMS}
              </p>
            </div>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <InternalLinkPicker
                  pageId={page.id}
                  links={internalLinks}
                  disabled={full}
                  onAdded={() => router.refresh()}
                />
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={full}
                  onClick={() => setExternalOpen(true)}
                >
                  <Plus className="size-4" />
                  Any other link
                </Button>
              </div>
            )}
          </div>

          {full && (
            <p className="text-muted-foreground rounded-xl border border-dashed p-3 text-xs">
              This page is full. Remove one, or make a second page.
            </p>
          )}

          {items.length === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm leading-relaxed">
              Nothing on the page yet. Add your giving page, this Sunday&apos;s
              form or your livestream from the list — or paste any other
              address.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((item, i) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  first={i === 0}
                  last={i === items.length - 1}
                  canManage={canManage}
                  onChanged={() => router.refresh()}
                />
              ))}
            </ul>
          )}
        </section>

        {/* --------------------------------------------- the danger */}
        {canManage && (
          <section className="rounded-2xl border border-destructive/30 p-4 sm:p-5">
            <h2 className="text-destructive font-bold">Delete this page</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              The address stops working and everything on the page goes with it.
              This cannot be undone.
            </p>
            <Button
              type="button"
              variant="outline"
              className="text-destructive border-destructive/40 mt-3"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          </section>
        )}
      </div>

      {/* ======================================================= right */}
      <div className="lg:sticky lg:top-20 lg:self-start">
        <p className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
          <Eye className="size-3.5" />
          Preview
        </p>
        {/*
          The real component, with the real props. Scaled down in a frame
          rather than redrawn, so what is on the right is what gets served.
        */}
        <div className="overflow-hidden rounded-2xl border shadow-sm">
          <div className="max-h-[32rem] overflow-y-auto">
            <LinkPageView
              title={title || page.title}
              tagline={tagline || null}
              styleId={style}
              layoutId={layout}
              showLogo={showLogo}
              showChurchName={showChurchName}
              churchName={churchName}
              churchLogo={churchLogo}
              churchTheme={churchTheme}
              items={items
                .filter((i) => i.isActive)
                .map((i) => ({
                  label: i.label,
                  url: i.url,
                  description: i.description,
                }))}
              preview
            />
          </div>
        </div>
      </div>

      {/* ---------------------------------------------- the dialogs */}
      <ExternalLinkDialog
        pageId={page.id}
        open={externalOpen}
        onOpenChange={setExternalOpen}
        onAdded={() => router.refresh()}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this link page?</DialogTitle>
            <DialogDescription>
              <span className="font-mono">
                {linkPageUrlForPrint(baseUrl, page.slug)}
              </span>{" "}
              will stop working, and the {items.length}{" "}
              {items.length === 1 ? "link" : "links"} on it will be gone.
              Anywhere you have pasted the address — a bio, a poster, a
              WhatsApp status — will lead nowhere.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDelete(false)}
            >
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await deleteLinkPage(page.id);
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success("Link page deleted.");
                  router.push("/links");
                })
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Delete it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One link
 * ------------------------------------------------------------------ */

function ItemRow({
  item,
  first,
  last,
  canManage,
  onChanged,
}: {
  item: EditorItem;
  first: boolean;
  last: boolean;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState(item.label);
  const [description, setDescription] = useState(item.description ?? "");
  const [open, setOpen] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "That did not work.");
        return;
      }
      onChanged();
    });
  }

  return (
    <li className="flex items-center gap-2 py-2.5">
      {/* Up / down rather than drag. A church secretary reorders this on a
          phone, where dragging a list inside a scrolling page is a fight. */}
      {canManage && (
        <div className="flex shrink-0 flex-col">
          <button
            type="button"
            aria-label={`Move ${item.label} up`}
            disabled={first || pending}
            onClick={() => run(() => moveLinkItem(item.id, "up"))}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ArrowUp className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Move ${item.label} down`}
            disabled={last || pending}
            onClick={() => run(() => moveLinkItem(item.id, "down"))}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ArrowDown className="size-3.5" />
          </button>
        </div>
      )}

      <button
        type="button"
        disabled={!canManage}
        onClick={() => setOpen(true)}
        className="min-w-0 flex-1 text-left disabled:cursor-default"
      >
        <p
          className={cn(
            "truncate text-sm font-semibold",
            !item.isActive && "text-muted-foreground line-through",
          )}
        >
          {item.label}
        </p>
        <p className="text-muted-foreground truncate text-xs">{item.url}</p>
      </button>

      {canManage && (
        <div className="flex shrink-0 items-center gap-1">
          {/* Switched off, not deleted: a church turns a link off between
              Sundays and back on again, and losing the wording each time is
              the reason people keep a notepad of their own links. */}
          <Switch
            aria-label={`Show ${item.label} on the page`}
            checked={item.isActive}
            disabled={pending}
            onCheckedChange={(v) =>
              run(() => updateLinkItem({ id: item.id, isActive: v }))
            }
          />
          <button
            type="button"
            aria-label={`Remove ${item.label}`}
            disabled={pending}
            onClick={() => run(() => removeLinkItem(item.id))}
            className="text-muted-foreground hover:text-destructive p-1.5 disabled:opacity-40"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit this link</DialogTitle>
            <DialogDescription className="break-all font-mono text-xs">
              {item.url}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor={`lab-${item.id}`}>What the button says</Label>
              <Input
                id={`lab-${item.id}`}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={`desc-${item.id}`}>
                A line underneath (shown by the Cards style)
              </Label>
              <Input
                id={`desc-${item.id}`}
                value={description}
                maxLength={DESCRIPTION_MAX}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await updateLinkItem({
                    id: item.id,
                    label,
                    description,
                  });
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  setOpen(false);
                  onChanged();
                })
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * Any other link
 * ------------------------------------------------------------------ */

function ExternalLinkDialog({
  pageId,
  open,
  onOpenChange,
  onAdded,
}: {
  pageId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => void;
}) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();

  function reset() {
    setLabel("");
    setUrl("");
    setDescription("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add any other link</DialogTitle>
          <DialogDescription>
            A WhatsApp group, your YouTube channel, a Google form — anything
            with an address. You can leave off the https://.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="ex-label">What the button says</Label>
            <Input
              id="ex-label"
              value={label}
              placeholder="Join our WhatsApp group"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ex-url">Where it goes</Label>
            <Input
              id="ex-url"
              value={url}
              placeholder="chat.whatsapp.com/..."
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ex-desc">A line underneath (optional)</Label>
            <Input
              id="ex-desc"
              value={description}
              maxLength={DESCRIPTION_MAX}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await addLinkItem({
                  pageId,
                  label,
                  url,
                  kind: "external",
                  description,
                });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success("Added.");
                reset();
                onOpenChange(false);
                onAdded();
              })
            }
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Add it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Bits
 * ------------------------------------------------------------------ */

function Toggle({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

/**
 * A tiny drawing of a style, for the picker.
 *
 * The one place a second rendering of a style is acceptable: a 40-pixel swatch
 * cannot be the real component, and its job is only to say "dark one" or
 * "gradient one" at a glance. It reads the SAME style record, so a style whose
 * background changes changes here too.
 */
function StyleSwatch({
  styleId,
  churchTheme,
}: {
  styleId: string;
  churchTheme: string;
}) {
  const s = getLinkPageStyle(styleId);

  const page =
    s.background === "dark"
      ? "bg-neutral-900"
      : s.background === "brand-gradient"
        ? "bg-gradient-to-b from-[var(--sw-from)] to-[var(--sw-to)]"
        : s.background === "tint"
          ? "bg-[color-mix(in_srgb,var(--sw)_10%,white)]"
          : "bg-white";

  const bar =
    s.button === "brand"
      ? "bg-[var(--sw)]"
      : s.button === "white"
        ? "bg-white"
        : s.button === "outline"
          ? "border border-[var(--sw)] bg-white/60"
          : "border-t border-neutral-300";

  const radius =
    s.radius === "full" ? "rounded-full" : s.radius === "xl" ? "rounded" : "";

  return (
    <div
      style={themeSwatchVars(churchTheme)}
      className={cn(
        "flex h-16 flex-col items-center justify-center gap-1 rounded-lg border px-2",
        page,
      )}
    >
      {[0, 1, 2].map((n) => (
        <span key={n} className={cn("h-1.5 w-full", radius, bar)} />
      ))}
    </div>
  );
}

function themeSwatchVars(theme: string): React.CSSProperties {
  // Named apart from the page's own `--brand`, so a swatch rendered inside the
  // styled preview cannot inherit the wrong colour.
  const t = getTheme(theme);
  return {
    ["--sw" as string]: t.primary,
    ["--sw-from" as string]: t.from,
    ["--sw-to" as string]: t.to,
  } as React.CSSProperties;
}
