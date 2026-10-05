import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, smsSenderSubmission } from "@/db/schema";
import {
  listNetworkSenderIds,
  type NetworkSenderId,
  type SenderIdStatus,
} from "@/lib/termii-sender";
import { indexNetworkSenderIds, normalizeSenderId } from "@/lib/sender-id-match";
import { notifyChurchManagers } from "@/lib/notifications";
import { recordAudit } from "@/lib/audit";

/**
 * Settle every church waiting on a sender ID against what the network says.
 *
 * WHY THIS IS NOT A BUTTON. A sender ID can be approved without this app ever
 * being involved — it is requested and approved on the Termii dashboard, which
 * is where that work actually happens. "RPM YOLA" was approved there and sat
 * here as "Awaiting review" with no way to release it: the approve action was
 * gated behind `stage === "submitted"`, so it appeared only for IDs this app
 * had itself submitted. Whether we did the submitting says nothing about
 * whether it is approved. Meanwhile the only button on the row was *Submit to
 * network*, for an ID the network already held — the one irreversible mistake
 * on that screen.
 *
 * So approval is read from the network on a schedule, not waited for. A church
 * approved on Tuesday should be sending on Tuesday, not whenever somebody next
 * opens an admin page and thinks to press Refresh. This runs from
 * /api/cron/platform-health and from the superadmin screen, which is the same
 * code either way.
 *
 * THE REGISTERED SPELLING WINS. A church stored as "RPM  YOLA" while the
 * network holds "RPM YOLA" is a church whose messages go out under a sender
 * that is not registered. IDs are matched with whitespace and case removed,
 * and the stored value is corrected to exactly what is registered.
 *
 * REJECTIONS ARE REPORTED, NOT APPLIED. Termii's API has been caught reporting
 * "pending" for IDs its own dashboard shows as approved (2026-09-27), so this
 * feed is known to be imperfect. A wrong "approved" releases a church a little
 * early; a wrong "rejected" emails a church to say their ID failed when it did
 * not, and there is no undoing being told that. A human presses Reject.
 */

export type ReconcileReport = {
  /** Released because the network already had them approved. */
  approved: { churchId: string; name: string; senderId: string }[];
  /** Stored spelling corrected to the one actually registered. */
  renamed: { churchId: string; name: string; from: string; to: string }[];
  /** On the network and declined. Surfaced for a human — never acted on. */
  declined: { churchId: string; name: string; senderId: string; raw: string }[];
  /** Still waiting, and the network has no record of them yet. */
  stillWaiting: number;
};

export type ReconcileOutcome =
  | ({ ok: true; ids: NetworkSenderId[] } & ReconcileReport)
  | { ok: false; error: string };

/** Who the audit trail should credit. A cron has no session to read one from. */
export type ReconcileActor = { id: string | null; name: string };

export async function reconcileSenderIdsWithNetwork(
  actor: ReconcileActor,
): Promise<ReconcileOutcome> {
  const list = await listNetworkSenderIds();
  if (!list.ok) return list;

  const byKey = indexNetworkSenderIds(list.ids);

  const waiting = await db
    .select({ id: church.id, name: church.name, senderId: church.smsSenderId })
    .from(church)
    .where(eq(church.smsSenderStatus, "pending"));

  const report: ReconcileReport = {
    approved: [],
    renamed: [],
    declined: [],
    stillWaiting: 0,
  };

  for (const c of waiting) {
    if (!c.senderId) continue;
    const key = normalizeSenderId(c.senderId);
    const net = byKey.get(key);
    if (!net) {
      report.stillWaiting++;
      continue;
    }

    await recordNetworkStatus(key, net.senderId, c.id, net.status);

    // Store what is actually registered, not what was typed.
    if (net.senderId !== c.senderId) {
      await db
        .update(church)
        .set({ smsSenderId: net.senderId })
        .where(eq(church.id, c.id));
      report.renamed.push({
        churchId: c.id,
        name: c.name,
        from: c.senderId,
        to: net.senderId,
      });
    }

    if (net.status === "approved") {
      await db
        .update(church)
        .set({
          smsSenderStatus: "approved",
          smsSenderStage: null,
          smsSenderNote: null,
        })
        .where(eq(church.id, c.id));
      await notifyChurchManagers({
        churchId: c.id,
        title: "SMS sender ID approved",
        body: `Your SMS sender ID “${net.senderId}” was approved — messages to your members will now be sent from it. You can send SMS from Communication.`,
        linkUrl: "/settings/sms",
        email: { subject: "Your SMS sender ID is approved 🎉" },
      });
      await recordAudit({
        actorUserId: actor.id,
        actorName: actor.name,
        action: "approve_sender_id",
        summary: `"${net.senderId}" approved — the network's list already had it approved`,
        targetType: "church",
        targetId: c.id,
      });
      report.approved.push({
        churchId: c.id,
        name: c.name,
        senderId: net.senderId,
      });
    } else if (net.status === "rejected") {
      report.declined.push({
        churchId: c.id,
        name: c.name,
        senderId: net.senderId,
        raw: net.raw,
      });
    } else {
      report.stillWaiting++;
    }
  }

  return { ok: true, ids: list.ids, ...report };
}

/** Keep the ledger's view of the network fresh (support/debugging trail). */
async function recordNetworkStatus(
  key: string,
  senderId: string,
  churchId: string,
  status: SenderIdStatus,
) {
  await db
    .insert(smsSenderSubmission)
    .values({
      senderKey: key,
      senderId,
      churchId,
      state: "exists",
      lastStatus: status,
      lastCheckedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: smsSenderSubmission.senderKey,
      set: { lastStatus: status, lastCheckedAt: new Date() },
    });
}
