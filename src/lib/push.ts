import "server-only";
import webpush from "web-push";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscription } from "@/db/schema";

const PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@flockinsight.com";

let configured = false;

export function isPushConfigured(): boolean {
  return !!(PUBLIC && PRIVATE);
}

function ensureConfigured() {
  if (configured || !isPushConfigured()) return;
  webpush.setVapidDetails(SUBJECT, PUBLIC as string, PRIVATE as string);
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

/**
 * Send a web-push message to every device of the given users.
 * No-ops gracefully when VAPID isn't configured. Returns the number sent.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<number> {
  if (!isPushConfigured() || userIds.length === 0) return 0;
  ensureConfigured();

  const ids = [...new Set(userIds)];
  const subs = await db
    .select()
    .from(pushSubscription)
    .where(inArray(pushSubscription.userId, ids));
  if (subs.length === 0) return 0;

  const data = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          data,
        );
        sent++;
      } catch {
        // Endpoint may be expired/gone; failures are non-fatal. We keep the
        // row (never delete) — it simply won't receive future pushes.
      }
    }),
  );
  return sent;
}
