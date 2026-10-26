import { toast } from "sonner";
import type { TFunction } from "@/lib/i18n/translate";
import {
  PDF_FAILURE_KEY,
  filenameFromDisposition,
  pdfOutcome,
  type PdfFailure,
} from "@/components/assistant/chat-shared";

/**
 * Saves a file the page already holds, on the device.
 *
 * The same few lines as downloadIcs in the booking flow, copied rather than
 * imported from lib/qr/download.ts, which would pull the QR renderer into
 * this chunk.
 */
function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  // Revoked a moment later: Safari and Firefox start the download after the
  // click returns, and an already-revoked URL saves nothing.
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** A Markdown download needs nothing from the server, so it does not go there. */
export function downloadText(body: string, filename: string, type = "text/markdown;charset=utf-8"): void {
  saveBlob(new Blob([body], { type }), filename);
}

/**
 * Fetches a PDF from the export route and saves it, and says why when it
 * cannot.
 *
 * Not a plain <a download>: the route explains each refusal (too many
 * downloads, figures this person's role no longer includes, a chat that is
 * gone), and a download link turns every one of them into the browser's own
 * "Failed - Server problem" in the downloads bar, which names no cause and no
 * way out. The route's English sentence goes to the console for whoever is
 * debugging; the toast is in the reader's language.
 */
export async function downloadPdf(href: string, t: TFunction): Promise<void> {
  const id = toast.loading(t("assistantPage.pdfPreparing"));
  const fail = (failure: PdfFailure) => {
    toast.error(t(PDF_FAILURE_KEY[failure]), { id });
  };

  let res: Response;
  try {
    res = await fetch(href, { credentials: "same-origin", cache: "no-store" });
  } catch (e) {
    console.error("[assistant] PDF download could not reach the server", e);
    fail("offline");
    return;
  }

  const failure = pdfOutcome({
    status: res.status,
    contentType: res.headers.get("content-type"),
    redirected: res.redirected,
  });
  if (failure) {
    let detail: string;
    try {
      detail = (await res.text()).slice(0, 300);
    } catch (e) {
      detail = `(the reply could not be read: ${e instanceof Error ? e.message : String(e)})`;
    }
    console.error("[assistant] PDF download refused", { status: res.status, failure, detail });
    fail(failure);
    return;
  }

  let blob: Blob;
  try {
    blob = await res.blob();
  } catch (e) {
    // The connection dropped part-way through the file.
    console.error("[assistant] PDF download broke off", e);
    fail("offline");
    return;
  }
  saveBlob(blob, filenameFromDisposition(res.headers.get("content-disposition")) ?? "flockinsight-assistant.pdf");
  toast.dismiss(id);
}
