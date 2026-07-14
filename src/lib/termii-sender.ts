import "server-only";
import { termiiBase } from "@/lib/sms";

/**
 * Termii sender-ID registration + approval status.
 * https://developers.termii.com/sender-id
 *
 * Flow: a church requests a sender ID, a superadmin reviews it and submits it
 * to Termii, then we poll Termii's sender-ID list to learn whether it's been
 * approved.
 *
 * Rule of the house: a failed lookup is NOT the same as "not registered".
 * Every lookup returns ok/error explicitly, because callers use it to decide
 * whether to register an ID — and a swallowed error there means a duplicate
 * registration on the network.
 */

export type SenderIdStatus = "approved" | "pending" | "rejected" | "unknown";

export type RequestResult =
  | { ok: true; alreadyExists?: boolean }
  | { ok: false; error: string };

const TIMEOUT_MS = 20_000;

export function normalizeSenderId(s: string): string {
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        api_key: apiKey,
        sender_id: opts.senderId,
        // Termii's docs have used both spellings over time — send both.
        usecase,
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
    console.error(
      `[termii] requestSenderId("${opts.senderId}") rejected: ${res.status} ${msg}`,
    );
    return { ok: false, error: msg || `Termii error ${res.status}` };
  } catch (e) {
    console.error("[termii] requestSenderId failed:", e);
    return { ok: false, error: "Could not reach the SMS gateway." };
  }
}

export type NetworkSenderId = { senderId: string; status: SenderIdStatus; raw: string };

export type SenderIdLookup =
  /** The network answered, and the ID is registered. */
  | { ok: true; found: true; status: SenderIdStatus; raw: string }
  /** The network answered, and the ID is not registered at all. */
  | { ok: true; found: false }
  /** We could not get an answer — say nothing about whether it's registered. */
  | { ok: false; error: string };

type SenderIdRow = { sender_id?: string; status?: string };

/**
 * Termii's status vocabulary is not fixed and has included "active",
 * "approved", "unblock", "blocked", "pending"… Anything we don't recognise
 * stays "pending" rather than guessing a verdict.
 */
export function mapStatus(raw: string | undefined): SenderIdStatus {
  const st = (raw || "").trim().toLowerCase();
  if (!st) return "pending";
  // "unblock(ed)" means NOT blocked — check before the rejection patterns, or
  // the "block" inside it reads as a rejection.
  if (/unblock/.test(st)) return "approved";
  if (/(reject|declin|block|denied|fail|inactive|suspend)/.test(st)) return "rejected";
  if (/(active|approve|verified|published|complete|success|ok|live)/.test(st))
    return "approved";
  return "pending";
}

/** One page of Termii's sender-ID list. */
async function fetchPage(
  apiKey: string,
  page: number,
): Promise<
  | { ok: true; rows: SenderIdRow[]; hasNext: boolean }
  | { ok: false; error: string }
> {
  const res = await fetch(
    `${termiiBase()}/api/sender-id?api_key=${encodeURIComponent(apiKey)}&page=${page}`,
    {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  const body = await res.text();
  let data: {
    data?: SenderIdRow[];
    current_page?: number;
    last_page?: number;
    total_pages?: number;
    next_page_url?: string | null;
    message?: string;
  } | null = null;
  try {
    data = JSON.parse(body);
  } catch {
    /* fall through — handled below */
  }

  if (!res.ok || !data) {
    const detail = data?.message || body.slice(0, 200) || `HTTP ${res.status}`;
    console.error(`[termii] sender-id list page ${page} failed: ${res.status} ${detail}`);
    return { ok: false, error: `The SMS network returned an error: ${detail}` };
  }
  if (!Array.isArray(data.data)) {
    console.error(`[termii] sender-id list page ${page}: unexpected shape`, body.slice(0, 300));
    return { ok: false, error: "The SMS network returned an unexpected response." };
  }

  const rows = data.data;
  const last = data.last_page ?? data.total_pages ?? page;
  const hasNext = data.next_page_url
    ? true
    : (data.current_page ?? page) < last && rows.length > 0;
  return { ok: true, rows, hasNext };
}

/**
 * Every sender ID registered on our Termii account. Used by the superadmin
 * diagnostics panel — when a lookup disagrees with the Termii dashboard, this
 * shows exactly what the API is telling us.
 */
export async function listNetworkSenderIds(): Promise<
  { ok: true; ids: NetworkSenderId[] } | { ok: false; error: string }
> {
  const apiKey = process.env.TERMII_API_KEY;
  if (!apiKey) return { ok: false, error: "SMS is not configured on the server." };

  const ids: NetworkSenderId[] = [];
  try {
    for (let page = 1; page <= 50; page++) {
      const res = await fetchPage(apiKey, page);
      if (!res.ok) return res;
      for (const r of res.rows) {
        if (!r.sender_id) continue;
        ids.push({
          senderId: r.sender_id,
          status: mapStatus(r.status),
          raw: String(r.status ?? ""),
        });
      }
      if (!res.hasNext) break;
    }
    return { ok: true, ids };
  } catch (e) {
    console.error("[termii] listNetworkSenderIds failed:", e);
    return { ok: false, error: "Could not reach the SMS gateway." };
  }
}

/**
 * Look a sender ID up on the network. `found: false` means the network
 * answered and does not have it; a failure returns `ok: false` so callers can
 * refuse to act rather than assume it isn't registered.
 */
export async function lookupSenderId(senderId: string): Promise<SenderIdLookup> {
  const apiKey = process.env.TERMII_API_KEY;
  if (!apiKey) return { ok: false, error: "SMS is not configured on the server." };
  const target = normalizeSenderId(senderId);

  try {
    for (let page = 1; page <= 50; page++) {
      const res = await fetchPage(apiKey, page);
      if (!res.ok) return res;

      const match = res.rows.find(
        (r) => r.sender_id && normalizeSenderId(r.sender_id) === target,
      );
      if (match) {
        const raw = String(match.status ?? "");
        const status = mapStatus(match.status);
        console.info(`[termii] "${senderId}" → status "${raw}" (${status})`);
        return { ok: true, found: true, status, raw };
      }
      if (!res.hasNext) break;
    }
    console.info(`[termii] "${senderId}" is not registered on the network`);
    return { ok: true, found: false };
  } catch (e) {
    console.error("[termii] lookupSenderId failed:", e);
    return { ok: false, error: "Could not reach the SMS gateway." };
  }
}
