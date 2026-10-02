"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/storage-bytes";
import { PROOF_MIME, proofRejection } from "@/lib/contributions-shared";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

/**
 * Attaching a receipt, from inside the app or from the public link.
 *
 * It uploads immediately rather than on submit, and hands back a media id the
 * surrounding form sends with everything else. That ordering is deliberate: the
 * upload is the slow part, and on the connections this serves, doing it while
 * somebody is still typing the reference number is the difference between a
 * form that submits instantly and one that appears to hang after they press the
 * button. It also means a failed upload is reported next to the field that
 * caused it, while the rest of what they typed is still on screen — and the
 * payment can be recorded without the receipt rather than lost with it.
 *
 * The file is checked here AND on the server. The client check exists to tell
 * somebody their 12 MB photo is too big before they spend two minutes of their
 * data allowance discovering it; the server check is the one that is enforced.
 */

export type ProofValue = {
  mediaId: string;
  bytes: number;
  mime: string;
} | null;

export function ProofField({
  value,
  onChange,
  /** One of these, matching the upload route: a pot id, or a public slug. */
  potId,
  slug,
  disabled,
  compact = false,
  labels,
}: {
  value: ProofValue;
  onChange: (next: ProofValue) => void;
  potId?: string;
  slug?: string;
  disabled?: boolean;
  compact?: boolean;
  /**
   * The three words shown on the control. Passed in rather than read from the
   * dictionary here because the wording differs by caller: a leader sees
   * "Attach a receipt", and somebody on the public link is asked for theirs.
   */
  labels: {
    attach: string;
    attached: string;
    hint: string;
  };
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);

    const rejection = proofRejection({ type: file.type, size: file.size });
    if (rejection) {
      setError(rejection);
      // Clear the input so choosing the SAME file again still fires a change
      // event — otherwise a corrected rotation of the same photo does nothing.
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (potId) form.append("potId", potId);
      if (slug) form.append("slug", slug);

      const res = await fetch("/api/contributions/proof", {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; mediaId: string; bytes: number; mime: string }
        | { ok: false; error: string }
        | null;

      if (!data) {
        setError(t("contributions.uploadIncomplete"));
        return;
      }
      if (!data.ok) {
        setError(data.error);
        return;
      }
      setName(file.name);
      onChange({ mediaId: data.mediaId, bytes: data.bytes, mime: data.mime });
    } catch {
      // Named rather than swallowed: on a weak connection this is the most
      // likely outcome, and "nothing happened" is the worst thing to show.
      setError(t("contributions.uploadDropped"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function clear() {
    /*
     * The uploaded file is left where it is.
     *
     * Removing it here would mean an unauthenticated delete endpoint, and the
     * row is unattached — nothing points at it, so it is swept up by the same
     * housekeeping that releases settled receipts. A few orphaned receipts
     * costing kilobytes is a far better trade than an endpoint that deletes
     * files on request.
     */
    onChange(null);
    setName(null);
    setError(null);
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={PROOF_MIME.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      {value ? (
        <div className="bg-muted/50 flex items-center gap-2.5 rounded-xl border p-2.5">
          <span className="bg-success/15 text-success grid size-9 shrink-0 place-items-center rounded-lg">
            {value.mime === "application/pdf" ? (
              <FileText className="size-4" aria-hidden />
            ) : (
              <Paperclip className="size-4" aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{labels.attached}</p>
            <p className="text-muted-foreground truncate text-xs">
              {name ? `${name} · ` : ""}
              {formatBytes(value.bytes)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={clear}
            disabled={disabled}
            aria-label={t("contributions.removeProof")}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size={compact ? "sm" : "default"}
          className={cn(!compact && "w-full")}
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />{" "}
              {t("contributions.uploading")}
            </>
          ) : (
            <>
              <Paperclip className="size-4" aria-hidden /> {labels.attach}
            </>
          )}
        </Button>
      )}

      {error ? (
        <p className="text-destructive text-xs font-medium">{error}</p>
      ) : (
        !value && <p className="text-muted-foreground text-xs">{labels.hint}</p>
      )}
    </div>
  );
}
