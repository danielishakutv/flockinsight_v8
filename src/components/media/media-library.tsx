"use client";

import { useMemo, useRef, useState, useTransition } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { compress } from "@/components/settings/image-upload";
import { deleteMediaAction } from "@/app/(app)/media/actions";
import { formatBytes } from "@/lib/storage-bytes";
import type { StorageInfo } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function groupOf(m: Item): "image" | "audio" | "video" | "document" {
  if (m.mime.startsWith("image/")) return "image";
  if (m.mime.startsWith("audio/")) return "audio";
  if (m.mime.startsWith("video/")) return "video";
  return "document";
}

// Upload category the church picks → media `kind`.
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
  const [items, setItems] = useState<Item[]>(initial);
  const [used, setUsed] = useState(storage.used);
  const [filter, setFilter] = useState<Group>("all");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["value"]>(
    "sermon",
  );
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const limit = storage.limit;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const nearFull = pct >= 90;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((m) => {
      if (filter === "sermon" && m.kind !== "sermon") return false;
      if (
        filter !== "all" &&
        filter !== "sermon" &&
        groupOf(m) !== filter
      )
        return false;
      if (!q) return true;
      const name = (m.title || m.originalName || "").toLowerCase();
      return name.includes(q);
    });
  }, [items, filter, query]);

  async function uploadOne(file: File) {
    const isImage = file.type.startsWith("image/");
    const fd = new FormData();
    if (isImage) {
      const blob = await compress(file, 1920);
      fd.append(
        "file",
        blob,
        (file.name.replace(/\.[^.]+$/, "") || "image") + ".webp",
      );
    } else {
      fd.append("file", file);
    }
    fd.append("kind", category);
    const res = await fetch("/api/media/upload", { method: "POST", body: fd });
    const data = (await res.json().catch(() => null)) as
      | ({ ok: true } & Item & { id: string; bytes: number })
      | { ok: false; error: string }
      | null;
    if (!data || !data.ok) throw new Error(data?.error || "Upload failed");
    return data;
  }

  async function onPick(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    let added = 0;
    try {
      for (const file of Array.from(files)) {
        try {
          const data = await uploadOne(file);
          const item: Item = {
            id: data.id,
            kind: data.kind ?? category,
            mime: data.mime ?? file.type,
            bytes: data.bytes,
            url: data.url ?? null,
            provider: "cloudinary",
            resourceType: data.resourceType ?? null,
            title: data.title ?? null,
            originalName: file.name,
            width: data.width ?? null,
            height: data.height ?? null,
            durationSec: data.durationSec ?? null,
            createdAt: new Date().toISOString(),
          };
          setItems((prev) => [item, ...prev]);
          setUsed((u) => u + data.bytes);
          added++;
        } catch (e) {
          toast.error(
            `${file.name}: ${e instanceof Error ? e.message : "Upload failed"}`,
          );
        }
      }
      if (added) toast.success(`Uploaded ${added} file${added > 1 ? "s" : ""}.`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
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
            You&apos;re running low on storage. Delete files or upgrade to keep
            uploading.
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
              <Button
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Upload files
              </Button>
              <p className="text-muted-foreground text-sm">
                Images & video are optimised automatically to save space.
              </p>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => onPick(e.target.files)}
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((m) => (
            <MediaCard
              key={m.id}
              item={m}
              canManage={canManage}
              onDeleted={() => {
                setItems((prev) => prev.filter((x) => x.id !== m.id));
                setUsed((u) => Math.max(0, u - m.bytes));
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MediaCard({
  item,
  canManage,
  onDeleted,
}: {
  item: Item;
  canManage: boolean;
  onDeleted: () => void;
}) {
  const [pending, start] = useTransition();
  const group = groupOf(item);
  const name = item.title || item.originalName || "Untitled";
  const link = `/media/${item.id}`;

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
    <div className="bg-card flex flex-col overflow-hidden rounded-2xl border">
      <div className="bg-muted relative aspect-video">
        {group === "image" && item.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt={name} className="size-full object-cover" />
        ) : group === "video" && item.url ? (
          <video src={item.url} controls className="size-full object-contain" />
        ) : group === "audio" ? (
          <div className="flex size-full flex-col items-center justify-center gap-3 p-4">
            <Music className="text-muted-foreground size-8" />
            {item.url && (
              <audio src={item.url} controls className="w-full" />
            )}
          </div>
        ) : (
          <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-2">
            <FileText className="size-10" />
            <span className="text-xs uppercase">
              {item.mime.split("/").pop()}
            </span>
          </div>
        )}
        <span className="bg-background/80 absolute left-2 top-2 rounded-md px-2 py-0.5 text-xs font-medium capitalize backdrop-blur">
          {item.kind === "sermon" ? "Sermon" : group}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start gap-2">
          <GroupIcon group={group} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold" title={name}>
              {name}
            </p>
            <p className="text-muted-foreground text-xs">
              {formatBytes(item.bytes)}
              {fmtDuration(item.durationSec)
                ? ` · ${fmtDuration(item.durationSec)}`
                : ""}
            </p>
          </div>
        </div>

        <div className="mt-auto flex items-center gap-1 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={copyLink}
            title="Copy link"
          >
            <Link2 className="size-4" /> Link
          </Button>
          <Button asChild variant="ghost" size="sm" title="Download">
            <a href={`${link}?download=1`}>
              <Download className="size-4" /> Save
            </a>
          </Button>
          {canManage && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={onDelete}
              className="text-muted-foreground hover:text-destructive ml-auto"
              title="Delete"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function GroupIcon({ group }: { group: "image" | "audio" | "video" | "document" }) {
  const cls = "text-muted-foreground size-4 shrink-0";
  if (group === "image") return <ImageIcon className={cls} />;
  if (group === "audio") return <Music className={cls} />;
  if (group === "video") return <Film className={cls} />;
  return <FileText className={cls} />;
}
