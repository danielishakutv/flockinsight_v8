import "server-only";
import { termiiBase } from "@/lib/sms";

/**
 * Termii sender-ID registration + approval status.
 * https://developers.termii.com/sender-id
 *
 * Flow: a church requests a sender ID (goes to Termii for review), then we
 * poll Termii's sender-ID list to learn whether it's been approved.
 */

export type SenderIdStatus = "approved" | "pending" | "rejected" | "unknown";

export type RequestResult =
  | { ok: true; alreadyExists?: boolean }
  | { ok: false; error: string };

function norm(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/** Submit a sender-ID request to Termii for review. */
export async function requestSenderId(opts: {
  senderId: string;
  usecase: string;
  company: string;
}): Promise<RequestResult> {
  const apiKey = process.env.TERMII_API_KEY;
  if (!apiKey) return { ok: false, error: "SMS is not configured on the server." };

  // Termii requires a reasonably descriptive use-case.
  const usecase =
    opts.usecase.trim().length >= 20
      ? opts.usecase.trim()
      : `${opts.usecase.trim()} — church service alerts, event reminders and member updates for ${opts.company}.`;

  try {
    const res = await fetch(`${termiiBase()}/api/sender-id/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        sender_id: opts.senderId,
        use_case: usecase,
        company: opts.company,
      }),
    });
    const data = (await res.json().catch(() => null)) as
      | { code?: string; message?: string }
      | null;

    const msg = String(data?.message ?? "");
    if (res.ok && (data?.code === "ok" || /request|success/i.test(msg))) {
      return { ok: true };
    }
    // Treat "already requested / exists" as success — status check handles it.
    if (/exist|already|registered/i.test(msg)) {
      return { ok: true, alreadyExists: true };
    }
    return { ok: false, error: msg || `Termii error ${res.status}` };
  } catch (e) {
    console.error("[termii] requestSenderId failed:", e);
    return { ok: false, error: "Could not reach the SMS gateway." };
  }
}

type SenderIdRow = { sender_id?: string; status?: string };

/** Look up the approval status of a sender ID from Termii (paginates). */
export async function fetchSenderIdStatus(
  senderId: string,
): Promise<SenderIdStatus> {
  const apiKey = process.env.TERMII_API_KEY;
  if (!apiKey) return "unknown";
  const target = norm(senderId);

  try {
    for (let page = 1; page <= 20; page++) {
      const res = await fetch(
        `${termiiBase()}/api/sender-id?api_key=${encodeURIComponent(apiKey)}&page=${page}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) return "unknown";
      const data = (await res.json().catch(() => null)) as
        | {
            data?: SenderIdRow[];
            current_page?: number;
            last_page?: number;
            total_pages?: number;
            next_page_url?: string | null;
          }
        | null;
      const rows = data?.data ?? [];

      const match = rows.find((r) => r.sender_id && norm(r.sender_id) === target);
      if (match) {
        const st = (match.status || "").toLowerCase();
        if (/(active|approve|verified|published|success|ok)/.test(st)) return "approved";
        if (/(reject|declin|block|denied|fail)/.test(st)) return "rejected";
        return "pending";
      }

      const last = data?.last_page ?? data?.total_pages ?? page;
      const hasNext = data?.next_page_url ?? (data?.current_page ?? page) < last;
      if (!hasNext || rows.length === 0) break;
    }
    // Not in the list yet → still under review.
    return "pending";
  } catch (e) {
    console.error("[termii] fetchSenderIdStatus failed:", e);
    return "unknown";
  }
}
