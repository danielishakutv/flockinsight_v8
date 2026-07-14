import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { church, smsSenderSubmission } from "@/db/schema";
import { lookupSenderId, normalizeSenderId } from "@/lib/termii-sender";
import {
  notifyChurchManagers,
  notifySuperAdminsByEmail,
} from "@/lib/notifications";

export type SenderIdCheckSummary = {
  checked: number;
  approved: number;
  rejected: number;
  /** Couldn't get an answer from the network — left alone for the next run. */
  unreachable: number;
};

/**
 * Poll the network for every sender ID that's been submitted and is still
 * "processing", and settle it. On a definite verdict we update the church and
 * notify both the church's team (in-app + email) and the platform superadmins.
 * Run daily via cron.
 *
 * This is the safety net behind the superadmin's manual "Check status" — a
 * church should never sit on "Processing" after the network has approved it.
 */
export async function runSenderIdChecks(): Promise<SenderIdCheckSummary> {
  const rows = await db
    .select({ id: church.id, name: church.name, senderId: church.smsSenderId })
    .from(church)
    .where(
      and(
        eq(church.smsSenderStatus, "pending"),
        eq(church.smsSenderStage, "submitted"),
        isNotNull(church.smsSenderId),
      ),
    );

  const summary: SenderIdCheckSummary = {
    checked: rows.length,
    approved: 0,
    rejected: 0,
    unreachable: 0,
  };

  for (const c of rows) {
    if (!c.senderId) continue;

    const lookup = await lookupSenderId(c.senderId);
    if (!lookup.ok) {
      // Network hiccup — leave the church as it is and try again next run.
      summary.unreachable++;
      continue;
    }
    if (!lookup.found) continue; // not registered yet; nothing to settle

    await db
      .update(smsSenderSubmission)
      .set({ lastStatus: lookup.status, lastCheckedAt: new Date() })
      .where(eq(smsSenderSubmission.senderKey, normalizeSenderId(c.senderId)));

    if (lookup.status === "approved") {
      await db
        .update(church)
        .set({ smsSenderStatus: "approved", smsSenderStage: null, smsSenderNote: null })
        .where(eq(church.id, c.id));
      await notifyChurchManagers({
        churchId: c.id,
        title: "SMS sender ID approved",
        body: `Your SMS sender ID “${c.senderId}” was approved — messages to your members will now be sent from it. You can send SMS from Communication.`,
        linkUrl: "/settings/sms",
        email: { subject: "Your SMS sender ID is approved 🎉" },
      });
      await notifySuperAdminsByEmail({
        subject: `Sender ID approved: ${c.senderId}`,
        title: "Sender ID approved by the network",
        body: `${c.name}'s SMS sender ID "${c.senderId}" was just approved by the network. The church has been notified.`,
        linkPath: "/superadmin/sms",
      });
      summary.approved++;
    } else if (lookup.status === "rejected") {
      await db
        .update(church)
        .set({
          smsSenderStatus: "rejected",
          smsSenderStage: null,
          smsSenderNote: "Rejected by the network",
        })
        .where(eq(church.id, c.id));
      await notifyChurchManagers({
        churchId: c.id,
        title: "SMS sender ID rejected",
        body: `Your SMS sender ID “${c.senderId}” was not approved by the network. You can request a different one in Settings → SMS.`,
        linkUrl: "/settings/sms",
        email: { subject: "About your SMS sender ID request" },
      });
      await notifySuperAdminsByEmail({
        subject: `Sender ID rejected: ${c.senderId}`,
        title: "Sender ID rejected by the network",
        body: `${c.name}'s SMS sender ID "${c.senderId}" was rejected by the network.`,
        linkPath: "/superadmin/sms",
      });
      summary.rejected++;
    }
  }

  return summary;
}
