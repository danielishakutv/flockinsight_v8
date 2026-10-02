"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { CheckCircle2, ChevronDown, Loader2, Upload, X } from "lucide-react";
import { compress } from "@/components/settings/image-upload";
import {
  uploadDirect,
  UploadCancelled,
  type UploadProgress,
} from "@/lib/direct-upload";
import { formatBytes } from "@/lib/storage-bytes";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

export type UploadResult = {
  id: string;
  url: string | null;
  link: string;
  bytes: number;
  kind: string;
  mime: string;
  title: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  createdAt: string;
  originalName: string;
};

type Entry = {
  id: string;
  name: string;
  size: number;
  progress: number; // 0..100
  status: "uploading" | "done" | "error";
  error?: string;
  result?: UploadResult;
};

type Ctx = {
  uploads: Entry[];
  enqueue: (files: File[] | FileList, kind: string) => void;
  dismiss: (id: string) => void;
  clearFinished: () => void;
  onComplete: (cb: (r: UploadResult) => void) => () => void;
};

const UploadContext = createContext<Ctx | null>(null);

export function useUploads(): Ctx {
  const c = useContext(UploadContext);
  if (!c) throw new Error("useUploads must be used within <UploadProvider>");
  return c;
}

let counter = 0;
const tempId = () => `u${(counter += 1)}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * Big files go straight to Cloudinary; small ones keep the simple road.
 *
 * Posting a file through our own API means posting it through Cloudflare,
 * which rejects any request body over 100 MB with a 413 before our server
 * hears about it — so the upload fails at the edge, nothing reaches our logs,
 * and the person is told "Upload failed" with no way to find out why. It is
 * exactly the wall meeting recordings hit, and it is why somebody who
 * downloaded a recording and tried to add it by hand could not.
 *
 * Above this size the browser uploads to Cloudinary directly, in chunks, the
 * same way recordings already do. The threshold is far below Cloudflare's
 * limit on purpose: the point is never to go near it, not to go up to it.
 *
 * Small files stay on the original path because it demonstrably works and is
 * one round trip rather than three — and because the way to be sure a fix
 * helps is not to rewrite the case that was never broken.
 */
const DIRECT_UPLOAD_OVER = 8 * 1024 * 1024;

/**
 * App-wide upload manager. Because it lives in the app layout, uploads keep
 * running (and the progress widget stays visible) while the user navigates
 * around the app — they can leave the Media page and come back to see the
 * result. Uses XHR so we get real upload progress.
 */
export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [uploads, setUploads] = useState<Entry[]>([]);
  const listeners = useRef(new Set<(r: UploadResult) => void>());

  const onComplete = useCallback((cb: (r: UploadResult) => void) => {
    listeners.current.add(cb);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);

  const patch = useCallback((id: string, p: Partial<Entry>) => {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...p } : u)));
  }, []);


  const uploadDirectToCloudinary = useCallback(
    async (entryId: string, file: File, blob: Blob, filename: string, kind: string) => {
      const signRes = await fetch("/api/media/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, bytes: blob.size, mime: file.type }),
      });
      const signData = await signRes.json();
      if (!signData?.ok) {
        patch(entryId, {
          status: "error",
          // The server knows why — quota, permission, storage not set up — and
          // its sentence is more use than anything generic this end could write.
          error: signData?.error ?? "Could not start the upload.",
        });
        return;
      }

      const uploaded = await uploadDirect(
        blob,
        filename,
        signData.ticket,
        (p: UploadProgress) => patch(entryId, { progress: Math.min(95, p.percent) }),
      );

      const doneRes = await fetch("/api/media/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicId: uploaded.publicId,
          resourceType: signData.resourceType,
          kind,
          originalName: file.name,
          mime: file.type,
        }),
      });
      const doneData = await doneRes.json();
      if (!doneData?.ok) {
        patch(entryId, {
          status: "error",
          error: doneData?.error ?? "The upload finished but could not be saved.",
        });
        return;
      }

      const result: UploadResult = { ...(doneData as UploadResult), originalName: file.name };
      patch(entryId, { progress: 100, status: "done", result });
      listeners.current.forEach((l) => l(result));
    },
    [patch],
  );

  const uploadOne = useCallback(
    async (entryId: string, file: File, kind: string) => {
      let blob: Blob = file;
      let filename = file.name;
      if (file.type.startsWith("image/")) {
        try {
          blob = await compress(file, 1920);
          filename = (file.name.replace(/\.[^.]+$/, "") || "image") + ".webp";
        } catch {
          /* fall back to the original file */
        }
      }

      if (blob.size > DIRECT_UPLOAD_OVER) {
        try {
          await uploadDirectToCloudinary(entryId, file, blob, filename, kind);
        } catch (e) {
          /*
           * Named, never swallowed. A dropped connection part-way through a
           * large upload is the likeliest outcome on a weak link, and "nothing
           * happened" is the worst thing to show for it.
           */
          const message =
            e instanceof UploadCancelled
              ? "Upload cancelled."
              : e instanceof Error
                ? e.message
                : "The upload did not finish.";
          console.error("[media] direct upload failed", e);
          patch(entryId, { status: "error", error: message });
        }
        return;
      }

      const fd = new FormData();
      fd.append("file", blob, filename);
      fd.append("kind", kind);

      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/media/upload");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            patch(entryId, { progress: Math.min(95, Math.round((e.loaded / e.total) * 95)) });
        };
        xhr.onload = () => {
          let data: (UploadResult & { ok: true }) | { ok: false; error: string } | null = null;
          try {
            data = JSON.parse(xhr.responseText);
          } catch {
            data = null;
          }
          if (xhr.status >= 200 && xhr.status < 300 && data && data.ok) {
            const result: UploadResult = { ...(data as UploadResult), originalName: file.name };
            patch(entryId, { progress: 100, status: "done", result });
            listeners.current.forEach((l) => l(result));
          } else {
            patch(entryId, {
              status: "error",
              error: (data && !data.ok && data.error) || "Upload failed",
            });
          }
          resolve();
        };
        xhr.onerror = () => {
          patch(entryId, { status: "error", error: "Network error" });
          resolve();
        };
        xhr.send(fd);
      });
    },
    [patch, uploadDirectToCloudinary],
  );

  const enqueue = useCallback(
    (files: File[] | FileList, kind: string) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      const entries: Entry[] = arr.map((f) => ({
        id: tempId(),
        name: f.name,
        size: f.size,
        progress: 0,
        status: "uploading",
      }));
      setUploads((prev) => [...entries, ...prev]);
      // Sequential so the server's quota check stays accurate file-to-file.
      void (async () => {
        for (let i = 0; i < arr.length; i++) {
          await uploadOne(entries[i].id, arr[i], kind);
        }
      })();
    },
    [uploadOne],
  );

  const dismiss = useCallback(
    (id: string) => setUploads((prev) => prev.filter((u) => u.id !== id)),
    [],
  );
  const clearFinished = useCallback(
    () => setUploads((prev) => prev.filter((u) => u.status === "uploading")),
    [],
  );

  return (
    <UploadContext.Provider
      value={{ uploads, enqueue, dismiss, clearFinished, onComplete }}
    >
      {children}
      <UploadWidget />
    </UploadContext.Provider>
  );
}

function UploadWidget() {
  const t = useT();
  const { uploads, dismiss, clearFinished } = useUploads();
  const [open, setOpen] = useState(true);
  if (uploads.length === 0) return null;

  const active = uploads.filter((u) => u.status === "uploading").length;

  return (
    <div className="fixed bottom-20 right-3 z-50 w-72 overflow-hidden rounded-2xl border bg-card shadow-xl lg:bottom-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 border-b px-3 py-2.5 text-left text-sm font-semibold"
      >
        {active > 0 ? (
          <Loader2 className="text-primary size-4 animate-spin" />
        ) : (
          <CheckCircle2 className="text-success size-4" />
        )}
        {active > 0 ? `Uploading ${active}…` : "Uploads complete"}
        <span className="ml-auto flex items-center gap-1">
          {active === 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                clearFinished();
              }}
              className="text-muted-foreground hover:text-foreground text-xs font-medium"
            >
              Clear
            </span>
          )}
          <ChevronDown
            className={cn("size-4 transition-transform", open ? "" : "-rotate-90")}
          />
        </span>
      </button>
      {open && (
        <div className="max-h-64 space-y-2 overflow-y-auto p-2">
          {uploads.map((u) => (
            <div key={u.id} className="rounded-lg border p-2 text-xs">
              <div className="flex items-center gap-2">
                {u.status === "uploading" ? (
                  <Upload className="text-primary size-3.5 shrink-0" />
                ) : u.status === "done" ? (
                  <CheckCircle2 className="text-success size-3.5 shrink-0" />
                ) : (
                  <X className="text-destructive size-3.5 shrink-0" />
                )}
                <span className="truncate font-medium" title={u.name}>
                  {u.name}
                </span>
                {u.status !== "uploading" && (
                  <button
                    type="button"
                    onClick={() => dismiss(u.id)}
                    className="text-muted-foreground hover:text-foreground ml-auto"
                    aria-label={t("media.dismiss")}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              {u.status === "uploading" ? (
                <div className="mt-1.5">
                  <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full transition-all"
                      style={{ width: `${u.progress}%` }}
                    />
                  </div>
                  <p className="text-muted-foreground mt-1">{u.progress}%</p>
                </div>
              ) : u.status === "error" ? (
                <p className="text-destructive mt-1">{u.error}</p>
              ) : (
                <p className="text-muted-foreground mt-1">{formatBytes(u.size)} · done</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
