import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { fetchSenderIdStatus } from "@/lib/termii-sender";
import {
  notifyChurchManagers,
  notifySuperAdminsByEmail,
} from "@/lib/notifications";

export type SenderIdCheckSummary = {
  checked: number;
  approved: number;
  rejected: number;
};

/**
 * Poll the network for every sender ID that's been submitted and is still
 * "processing", and settle it. On a definite verdict we update the church and
 * notify both the church's team (in-app) and the platform superadmins (email).
 * Run daily via cron.
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
  };

  for (const c of rows) {
    if (!c.senderId) continue;
    let status;
    try {
      status = await fetchSenderIdStatus(c.senderId);
    } catch {
      continue; // network hiccup — try again next run
    }

    if (status === "approved") {
      await db
        .update(church)
        .set({ smsSenderStatus: "approved", smsSenderStage: null, smsSenderNote: null })
        .where(eq(church.id, c.id));
      await notifyChurchManagers({
        churchId: c.id,
        title: "SMS sender ID approved",
        body: "Your SMS sender ID was approved — you can now send SMS to your members.",
        linkUrl: "/settings/sms",
      });
      await notifySuperAdminsByEmail({
        subject: `Sender ID approved: ${c.senderId}`,
        title: "Sender ID approved by the network",
        body: `${c.name}'s SMS sender ID "${c.senderId}" was just approved by the network.`,
        linkPath: "/superadmin/sms",
      });
      summary.approved++;
    } else if (status === "rejected") {
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
        body: "Your SMS sender ID was rejected by the network. You can request a different one in Settings → SMS.",
        linkUrl: "/settings/sms",
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
