import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, smsSenderSubmission } from "@/db/schema";
import {
  listNetworkSenderIds,
  type NetworkSenderId,
  type SenderIdStatus,
} from "@/lib/termii-sender";
import {
  contestedSenderKeys,
  indexNetworkSenderIds,
  normalizeSenderId,
} from "@/lib/sender-id-match";
import { platformSenderId } from "@/lib/sms-sender";
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
  /**
   * Approved on the network, but NOT this church's to be approved for.
   * Needs a person: see `whoOwns` below.
   */
  contested: {
    churchId: string;
    name: string;
    senderId: string;
    reason: string;
  }[];
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
    contested: [],
    stillWaiting: 0,
  };

  /*
   * Two churches asking for the same name settle it with a person, not with
   * whichever row the database happened to return first.
   */
  const contestedKeys = contestedSenderKeys(
    waiting.map((c) => ({ churchId: c.id, senderId: c.senderId })),
  );

  for (const c of waiting) {
    if (!c.senderId) continue;
    const key = normalizeSenderId(c.senderId);
    const net = byKey.get(key);
    if (!net) {
      report.stillWaiting++;
      continue;
    }

    /*
     * IS THIS ID THIS CHURCH'S TO HAVE?
     *
     * Checked before anything is written, including the ledger row — writing
     * one would hand the contesting church the ownership record itself.
     *
     * "The network approved this ID" says nothing about WHOSE name it is, and
     * a sender ID is a name: approving one lets a church send messages that
     * arrive under it. Without this, any church could type a neighbouring
     * parish's sender ID into the request box and be approved automatically,
     * by a job that runs every half hour with nobody watching.
     */
    const conflict = await whoOwns(key, c.id, contestedKeys);
    if (conflict) {
      report.contested.push({
        churchId: c.id,
        name: c.name,
        senderId: c.senderId,
        reason: conflict,
      });
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

/**
 * Why this church may NOT be given this sender ID, or null if it may.
 *
 * Exported so the admin-initiated paths apply the same rule — a verdict that
 * depends on which button was pressed is not a rule.
 *
 * Three ways an ID is not yours to take:
 *
 *  - Another church already holds it, approved. The clearest case, and the one
 *    that lets a church send under a name people already recognise.
 *  - The ledger records someone else as the claimant. `sms_sender_submission`
 *    is unique per normalized ID and remembers who first asked for it, which
 *    is the closest thing to a register of ownership we have.
 *  - Two churches are asking for it right now. Neither gets it; a person
 *    decides. Passed in rather than queried so one query covers the sweep.
 *
 * And the platform's own sender ID is never given away at all: it is the name
 * FlockInsight's own system messages arrive under.
 */
export async function whoOwns(
  key: string,
  churchId: string,
  contestedKeys: Set<string>,
): Promise<string | null> {
  const platform = platformSenderId();
  if (platform && normalizeSenderId(platform) === key) {
    return "This is FlockInsight's own platform sender ID and cannot be given to a church.";
  }

  if (contestedKeys.has(key)) {
    return "More than one church is requesting this sender ID right now — decide which one it belongs to before approving either.";
  }

  const others = await db
    .select({ id: church.id, name: church.name })
    .from(church)
    .where(
      and(
        eq(church.smsSenderStatus, "approved"),
        ne(church.id, churchId),
        // Compared the same way everywhere: spaces and case removed.
        sql`replace(lower(${church.smsSenderId}), ' ', '') = ${key}`,
      ),
    )
    .limit(1);
  if (others.length > 0) {
    return `“${others[0].name}” already holds this sender ID. Approving it here would let two churches send under one name.`;
  }

  const [ledger] = await db
    .select({ churchId: smsSenderSubmission.churchId })
    .from(smsSenderSubmission)
    .where(eq(smsSenderSubmission.senderKey, key))
    .limit(1);
  if (ledger?.churchId && ledger.churchId !== churchId) {
    return "This sender ID was registered for a different church. Check who it belongs to before approving it here.";
  }

  return null;
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
