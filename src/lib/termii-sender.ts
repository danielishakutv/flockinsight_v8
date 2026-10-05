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

/* The matching rule lives in lib/sender-id-match.ts — pure, so the browser can
 * apply the same one. Imported (this file uses it) and re-exported, so every
 * existing importer is unaffected. */
import { normalizeSenderId } from "@/lib/sender-id-match";
export { normalizeSenderId };

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
      | { code?: string; message?: string; error?: string; fieldErrors?: unknown[] }
      | null;

    const msg = String(data?.message ?? data?.error ?? "");

    /*
     * A 2xx is success, whatever it says.
     *
     * This used to require `code: "ok"` or the word "request" or "success" in
     * the message. The rewritten service answers with a Spring envelope and
     * neither is guaranteed, so a submission Termii had accepted could be
     * reported back as a failure — and then retried, which is how a duplicate
     * registration happens.
     */
    if (res.ok) return { ok: true };
    // Treat "already requested / exists" as success — status check handles it.
    if (/exist|already|registered/i.test(msg)) {
      return { ok: true, alreadyExists: true };
    }
    /*
     * Field-level validation, said in the words of whoever has to fix it. The
     * service now returns which field it refused and why — "Sender ID must be
     * between 3 and 11 characters" is something an admin can act on, where
     * "Termii error 400" is not.
     */
    const fields = Array.isArray(data?.fieldErrors)
      ? (data.fieldErrors as { field?: string; message?: string }[])
          .map((f) => [f.field, f.message].filter(Boolean).join(": "))
          .filter(Boolean)
          .join("; ")
      : "";

    const detail = fields || msg || `Termii error ${res.status}`;
    console.error(
      `[termii] requestSenderId("${opts.senderId}") rejected: ${res.status} ${detail}`,
    );
    return { ok: false, error: detail };
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

/**
 * The first page number this API uses.
 *
 * ZERO. Termii rewrote the sender-ID service and its pages are now
 * zero-indexed: asking for page 1 returns the SECOND page, skipping the first
 * fifteen sender IDs entirely. Verified against the live API — page 0 returned
 * twelve ids, page 1 returned nothing with `pageable.offset: 15`.
 *
 * Worth a named constant, because "start at 1" is the assumption that made
 * every lookup on a small account come back empty while the dashboard plainly
 * showed the ID.
 */
const FIRST_PAGE = 0;

type TermiiPage = {
  // The rewritten service: a Spring page.
  content?: SenderIdRow[];
  totalPages?: number;
  number?: number;
  last?: boolean;
  // The older Laravel-style response, still handled — see `readPage`.
  data?: SenderIdRow[];
  current_page?: number;
  last_page?: number;
  total_pages?: number;
  next_page_url?: string | null;
  message?: string;
};

/**
 * Read either envelope Termii might send.
 *
 * Both are understood rather than swapping one for the other. The old shape
 * may still be what some accounts are served, and a reader that handles both
 * cannot be broken by whichever arrives — which is the whole failure being
 * fixed here.
 */
export function readPage(
  data: TermiiPage,
  page: number,
): { rows: SenderIdRow[]; hasNext: boolean } | null {
  if (Array.isArray(data.content)) {
    const rows = data.content;
    const total = data.totalPages ?? 0;
    const current = data.number ?? page;
    // `last` is authoritative when present; otherwise compare against the
    // total, remembering that these page numbers start at zero.
    const hasNext = data.last === undefined ? current + 1 < total : !data.last;
    return { rows, hasNext };
  }

  if (Array.isArray(data.data)) {
    const rows = data.data;
    const last = data.last_page ?? data.total_pages ?? page;
    const hasNext = data.next_page_url
      ? true
      : (data.current_page ?? page) < last && rows.length > 0;
    return { rows, hasNext };
  }

  return null;
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
  let data: TermiiPage | null = null;
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

  const read = readPage(data, page);
  if (!read) {
    console.error(`[termii] sender-id list page ${page}: unexpected shape`, body.slice(0, 300));
    return { ok: false, error: "The SMS network returned an unexpected response." };
  }

  return { ok: true, rows: read.rows, hasNext: read.hasNext };
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
    for (let page = FIRST_PAGE; page < FIRST_PAGE + 50; page++) {
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
    for (let page = FIRST_PAGE; page < FIRST_PAGE + 50; page++) {
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
