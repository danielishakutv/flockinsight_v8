import { asc, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, communicationLog, group, member, staff } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { getSmsPrice } from "@/lib/platform-settings";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import {
  CommunicationClient,
  type CommMember,
} from "@/components/communication/communication-client";

export const metadata = { title: "Communication" };

export default async function CommunicationPage() {
  const { church: c } = await requireChurch();
  await requireCan("communication.view");
  const canManage = await can("communication.manage");

  const [members, groups, [{ staffCount }], [smsRow], price, recent] =
    await Promise.all([
      db
        .select({
          id: member.id,
          firstName: member.firstName,
          lastName: member.lastName,
          phone: member.phone,
          email: member.email,
        })
        .from(member)
        .where(eq(member.churchId, c.id))
        .orderBy(asc(member.firstName), asc(member.lastName)),
      db
        .select({ id: group.id, name: group.name })
        .from(group)
        .where(eq(group.churchId, c.id))
        .orderBy(asc(group.name)),
      db
        .select({ staffCount: count() })
        .from(staff)
        .where(eq(staff.organizationId, c.id)),
      db
        .select({
          status: church.smsSenderStatus,
          balance: church.walletBalance,
        })
        .from(church)
        .where(eq(church.id, c.id))
        .limit(1),
      getSmsPrice(),
      db
        .select({
          id: communicationLog.id,
          channel: communicationLog.channel,
          audience: communicationLog.audience,
          subject: communicationLog.subject,
          body: communicationLog.body,
          recipients: communicationLog.recipients,
          sent: communicationLog.sent,
          failed: communicationLog.failed,
          cost: communicationLog.cost,
          createdAt: communicationLog.createdAt,
        })
        .from(communicationLog)
        .where(eq(communicationLog.churchId, c.id))
        .orderBy(desc(communicationLog.createdAt))
        .limit(20),
    ]);

  const list: CommMember[] = members.map((m) => ({
    id: m.id,
    name: [m.firstName, m.lastName].filter(Boolean).join(" "),
    phone: m.phone,
    email: m.email,
  }));

  return (
    <PageContainer>
      <PageHeader
        title="Communication"
        description="Send SMS, email and notices to your church."
      />
      <CommunicationClient
        canManage={canManage}
        members={list}
        groups={groups}
        staffCount={Number(staffCount)}
        currency={c.currency}
        smsPrice={price}
        smsBalance={Number(smsRow.balance)}
        senderApproved={smsRow.status === "approved"}
        recent={recent.map((r) => ({
          id: r.id,
          channel: r.channel,
          audience: r.audience,
          subject: r.subject,
          body: r.body,
          recipients: r.recipients,
          sent: r.sent,
          failed: r.failed,
          cost: Number(r.cost),
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </PageContainer>
  );
}
