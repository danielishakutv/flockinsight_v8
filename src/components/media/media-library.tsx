"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  Upload,
  Loader2,
  Link2,
  Download,
  Trash2,
  FileText,
  Music,
  Film,
  ImageIcon,
  Search,
  HardDrive,
  ArrowUpCircle,
  Play,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { deleteMediaAction } from "@/app/(app)/media/actions";
import { useUploads, type UploadResult } from "@/components/media/upload-provider";
import { formatBytes } from "@/lib/storage-bytes";
import type { StorageInfo } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  kind: string;
  mime: string;
  bytes: number;
  url: string | null;
  provider: string;
  resourceType: string | null;
  title: string | null;
  originalName: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  createdAt: string;
};

type Group = "all" | "image" | "audio" | "video" | "document" | "sermon";

function groupOf(m: { mime: string }): "image" | "audio" | "video" | "document" {
  if (m.mime.startsWith("image/")) return "image";
  if (m.mime.startsWith("audio/")) return "audio";
  if (m.mime.startsWith("video/")) return "video";
  return "document";
}

/** The best src for a media item — Cloudinary URL, else our own /media route. */
function srcOf(item: { url: string | null; id: string }): string {
  return item.url || `/media/${item.id}`;
}

const CATEGORIES = [
  { value: "sermon", label: "Sermon" },
  { value: "photo", label: "Photo" },
  { value: "file", label: "Document / Other" },
] as const;

const FILTERS: { value: Group; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sermon", label: "Sermons" },
  { value: "image", label: "Images" },
  { value: "audio", label: "Audio" },
  { value: "video", label: "Video" },
  { value: "document", label: "Documents" },
];

function fmtDuration(s: number | null): string | null {
  if (!s || s <= 0) return null;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function MediaLibrary({
  configured,
  canManage,
  storage,
  items: initial,
}: {
  configured: boolean;
  canManage: boolean;
  storage: StorageInfo;
  items: Item[];
}) {
  const { enqueue, onComplete } = useUploads();
  const [items, setItems] = useState<Item[]>(initial);
  const [used, setUsed] = useState(storage.used);
  const [filter, setFilter] = useState<Group>("all");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["value"]>("sermon");
  const [preview, setPreview] = useState<Item | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Live-add files as background uploads finish (even after navigating back).
  useEffect(() => {
    return onComplete((r: UploadResult) => {
      setItems((prev) => {
        if (prev.some((x) => x.id === r.id)) return prev;
        return [
          {
            id: r.id,
            kind: r.kind,
            mime: r.mime,
            bytes: r.bytes,
            url: r.url,
            provider: "cloudinary",
            resourceType: null,
            title: r.title,
            originalName: r.originalName,
            width: r.width,
            height: r.height,
            durationSec: r.durationSec,
            createdAt: r.createdAt ?? new Date().toISOString(),
          },
          ...prev,
        ];
      });
      setUsed((u) => u + r.bytes);
    });
  }, [onComplete]);

  const limit = storage.limit;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const nearFull = pct >= 90;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((m) => {
      if (filter === "sermon" && m.kind !== "sermon") return false;
      if (filter !== "all" && filter !== "sermon" && groupOf(m) !== filter) return false;
      if (!q) return true;
      return (m.title || m.originalName || "").toLowerCase().includes(q);
    });
  }, [items, filter, query]);

  function pick(files: FileList | null) {
    if (!files?.length) return;
    enqueue(files, category);
    if (inputRef.current) inputRef.current.value = "";
    toast.message("Upload started — you can keep working while it finishes.");
  }

  return (
    <div className="space-y-5">
      {/* Storage usage */}
      <div className="bg-card rounded-2xl border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary grid size-10 place-items-center rounded-xl">
              <HardDrive className="size-5" />
            </div>
            <div>
              <p className="font-semibold">
                {formatBytes(used)}{" "}
                <span className="text-muted-foreground font-normal">
                  of {formatBytes(limit)} used
                </span>
              </p>
              <p className="text-muted-foreground text-sm">
                {formatBytes(Math.max(0, limit - used))} free
              </p>
            </div>
          </div>
          <Button asChild variant={nearFull ? "default" : "outline"} size="sm">
            <Link href="/settings/storage">
              <ArrowUpCircle className="size-4" /> Upgrade storage
            </Link>
          </Button>
        </div>
        <div className="bg-muted mt-3 h-2 w-full overflow-hidden rounded-full">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              nearFull ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        {nearFull && (
          <p className="text-destructive mt-2 text-sm">
            You&apos;re running low on storage. Delete files or upgrade to keep uploading.
          </p>
        )}
      </div>

      {/* Upload */}
      {canManage && (
        <div className="bg-card rounded-2xl border p-4 sm:p-5">
          {!configured ? (
            <p className="text-muted-foreground text-sm">
              Media uploads aren&apos;t configured on this server yet. Add your
              Cloudinary credentials to enable uploads.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Category</label>
                <div className="flex gap-1.5">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setCategory(c.value)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                        category === c.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <Button type="button" onClick={() => inputRef.current?.click()}>
                <Upload className="size-4" /> Upload files
              </Button>
              <p className="text-muted-foreground text-sm">
                Images & video are optimised automatically. Uploads keep running
                if you move to another page.
              </p>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => pick(e.target.files)}
              />
            </div>
          )}
        </div>
      )}

      {/* Filters + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search files…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-muted-foreground rounded-2xl border border-dashed py-16 text-center">
          {items.length === 0
            ? "No files yet. Upload sermons, photos or documents to get started."
            : "No files match your filter."}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {filtered.map((m) => (
            <MediaCard
              key={m.id}
              item={m}
              canManage={canManage}
              onOpen={() => setPreview(m)}
              onDeleted={() => {
                setItems((prev) => prev.filter((x) => x.id !== m.id));
                setUsed((u) => Math.max(0, u - m.bytes));
              }}
            />
          ))}
        </div>
      )}

      <PreviewModal item={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function MediaCard({
  item,
  canManage,
  onOpen,
  onDeleted,
}: {
  item: Item;
  canManage: boolean;
  onOpen: () => void;
  onDeleted: () => void;
}) {
  const [pending, start] = useTransition();
  const group = groupOf(item);
  const name = item.title || item.originalName || "Untitled";
  const link = `/media/${item.id}`;
  const src = srcOf(item);

  function copyLink() {
    const abs =
      typeof window !== "undefined"
        ? new URL(link, window.location.origin).toString()
        : link;
    navigator.clipboard
      .writeText(abs)
      .then(() => toast.success("Link copied"))
      .catch(() => toast.error("Couldn't copy link"));
  }

  function onDelete() {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    start(async () => {
      const res = await deleteMediaAction(item.id);
      if (res.ok) {
        toast.success("File deleted");
        onDeleted();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="bg-card group flex flex-col overflow-hidden rounded-xl border">
      <button
        type="button"
        onClick={onOpen}
        className="bg-muted relative aspect-square w-full overflow-hidden"
        title={`Preview ${name}`}
      >
        {group === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={name}
            loading="lazy"
            className="size-full object-cover transition-transform group-hover:scale-105"
          />
        ) : group === "video" ? (
          <div className="grid size-full place-items-center bg-slate-900">
            <div className="grid size-11 place-items-center rounded-full bg-white/90 text-slate-900">
              <Play className="size-5 translate-x-0.5" />
            </div>
          </div>
        ) : group === "audio" ? (
          <div className="from-primary/20 grid size-full place-items-center bg-gradient-to-br to-fuchsia-500/20">
            <Music className="text-primary size-8" />
          </div>
        ) : (
          <div className="text-muted-foreground grid size-full place-items-center">
            <FileText className="size-8" />
          </div>
        )}
        <span className="bg-background/85 absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize backdrop-blur">
          {item.kind === "sermon" ? "Sermon" : group}
        </span>
      </button>

      <div className="flex flex-1 flex-col gap-1 p-2">
        <p className="truncate text-xs font-semibold leading-tight" title={name}>
          {name}
        </p>
        <p className="text-muted-foreground text-[11px]">
          {formatBytes(item.bytes)}
          {fmtDuration(item.durationSec) ? ` · ${fmtDuration(item.durationSec)}` : ""}
        </p>
        <div className="mt-auto flex items-center gap-0.5 pt-1">
          <IconBtn title="Copy link" onClick={copyLink}>
            <Link2 className="size-4" />
          </IconBtn>
          <Button asChild variant="ghost" size="icon" className="size-7" title="Download">
            <a href={`${link}?download=1`}>
              <Download className="size-4" />
            </a>
          </Button>
          {canManage && (
            <IconBtn
              title="Delete"
              onClick={onDelete}
              className="text-muted-foreground hover:text-destructive ml-auto"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            </IconBtn>
          )}
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-7", className)}
      title={title}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function PreviewModal({ item, onClose }: { item: Item | null; onClose: () => void }) {
  if (!item) return null;
  const group = groupOf(item);
  const name = item.title || item.originalName || "Untitled";
  const src = srcOf(item);
  const isPdf = item.mime === "application/pdf";

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {group === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={name}
              className="mx-auto max-h-[70vh] w-auto rounded-lg object-contain"
            />
          ) : group === "video" ? (
            <video
              src={src}
              controls
              autoPlay
              className="max-h-[70vh] w-full rounded-lg bg-black"
            />
          ) : group === "audio" ? (
            <div className="bg-muted flex flex-col items-center gap-4 rounded-xl p-8">
              <Music className="text-primary size-12" />
              <audio src={src} controls autoPlay className="w-full" />
            </div>
          ) : isPdf ? (
            <object data={src} type="application/pdf" className="h-[70vh] w-full rounded-lg border">
              <div className="text-muted-foreground p-8 text-center text-sm">
                Can&apos;t preview this PDF here.
                <a href={src} target="_blank" rel="noreferrer" className="text-primary ml-1 font-medium">
                  Open it in a new tab
                </a>
                .
              </div>
            </object>
          ) : (
            <div className="text-muted-foreground bg-muted grid place-items-center gap-3 rounded-xl p-12 text-center">
              <FileText className="size-12" />
              <p className="text-sm">No inline preview for this file type.</p>
              <Button asChild variant="outline" size="sm">
                <a href={src} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" /> Open file
                </a>
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const abs = new URL(`/media/${item.id}`, window.location.origin).toString();
                navigator.clipboard.writeText(abs).then(() => toast.success("Link copied"));
              }}
            >
              <Link2 className="size-4" /> Copy link
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/media/${item.id}?download=1`}>
                <Download className="size-4" /> Download
              </a>
            </Button>
            <span className="text-muted-foreground ml-auto text-xs">
              {formatBytes(item.bytes)}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// (kept for potential reuse)
export function MediaGroupIcon({ group }: { group: "image" | "audio" | "video" | "document" }) {
  const cls = "text-muted-foreground size-4 shrink-0";
  if (group === "image") return <ImageIcon className={cls} />;
  if (group === "audio") return <Music className={cls} />;
  if (group === "video") return <Film className={cls} />;
  return <FileText className={cls} />;
}
