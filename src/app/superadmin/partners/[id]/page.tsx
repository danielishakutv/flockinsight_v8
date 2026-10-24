import { and, asc, desc, eq, gt, max, or, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, church, partner, session, staff, user } from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import {
  partnerChurches,
  partnerEarnings,
  partnerPayouts,
  partnerTierNow,
  partnerWallet,
} from "@/lib/partners";
import { partnerShareLink } from "@/lib/partner-link";
import { siteUrl } from "@/lib/site";
import { PartnerDetail } from "@/components/superadmin/partner-detail";

export const metadata = { title: "Partner · Admin" };
export const dynamic = "force-dynamic";

/**
 * One Partner, everything about them, and every lever on their account.
 *
 * Behind `platform.finance.manage`, like the list. The LOGIN levers — email,
 * password, signing them out — also need `platform.users.manage` and are
 * enforced by the user actions themselves: a Partner's login can be a pastor's
 * login too, so whoever can reset it can walk into that church. Without the
 * permission the section says so rather than offering buttons that bounce.
 */
export default async function SuperadminPartnerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = await requirePlatform("platform.finance.manage");
  // A uuid column compared with anything else is a database error, not a 404.
  if (!z.string().uuid().safeParse(id).success) notFound();

  const [row] = await db
    .select({
      p: partner,
      login: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        mustChangePassword: user.mustChangePassword,
        isSuperAdmin: user.isSuperAdmin,
        createdAt: user.createdAt,
      },
    })
    .from(partner)
    .innerJoin(user, eq(user.id, partner.userId))
    .where(eq(partner.id, id))
    .limit(1);
  if (!row) notFound();
  const { p, login } = row;

  const now = new Date();
  const [
    wallet,
    churches,
    earnings,
    payouts,
    tierNow,
    seats,
    [sessions],
    activity,
  ] = await Promise.all([
    partnerWallet(p.id),
    partnerChurches(p.id),
    partnerEarnings(p.id, 100),
    partnerPayouts(p.id),
    partnerTierNow(p.id, p.tierOverride),
    // The churches this LOGIN works in, so whoever changes the password knows
    // it is not only a Partner account they are changing.
    db
      .select({ churchId: church.id, churchName: church.name, role: staff.role })
      .from(staff)
      .innerJoin(church, eq(church.id, staff.organizationId))
      .where(and(eq(staff.userId, login.id), eq(staff.temp, false)))
      .orderBy(asc(church.name)),
    db
      .select({
        live: sql<number>`count(*)::int`,
        lastSignIn: max(session.createdAt),
      })
      .from(session)
      .where(and(eq(session.userId, login.id), gt(session.expiresAt, now))),
    /*
     * Everything done TO this Partner or their login, newest first. Rows
     * written before audits carried a target (the status changes from v0.75)
     * name the Partner only in meta, so that is asked too — one table, flat
     * conditions, nothing for the raw-SQL qualifier trap to bite.
     */
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        summary: auditLog.summary,
        severity: auditLog.severity,
        actorName: auditLog.actorName,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(
        or(
          and(eq(auditLog.targetType, "partner"), eq(auditLog.targetId, p.id)),
          and(eq(auditLog.targetType, "user"), eq(auditLog.targetId, login.id)),
          and(
            eq(auditLog.action, "platform.partner.status"),
            sql`${auditLog.meta}->>'partnerId' = ${p.id}`,
          ),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(50),
  ]);

  return (
    <PartnerDetail
      partner={{
        id: p.id,
        code: p.code,
        displayName: p.displayName,
        status: p.status,
        statusReason: p.statusReason,
        statusChangedAt: p.statusChangedAt?.toISOString() ?? null,
        phone: p.phone,
        emailVerifiedAt: p.emailVerifiedAt?.toISOString() ?? null,
        phoneVerifiedAt: p.phoneVerifiedAt?.toISOString() ?? null,
        bankName: p.bankName,
        bankAccountNumber: p.bankAccountNumber,
        bankAccountName: p.bankAccountName,
        tierOverride: p.tierOverride,
        note: p.note,
        createdAt: p.createdAt.toISOString(),
      }}
      login={{
        id: login.id,
        name: login.name,
        email: login.email,
        emailVerified: login.emailVerified,
        mustChangePassword: login.mustChangePassword,
        isSuperAdmin: login.isSuperAdmin,
        createdAt: login.createdAt.toISOString(),
        liveSessions: Number(sessions?.live ?? 0),
        lastSignIn: sessions?.lastSignIn
          ? new Date(sessions.lastSignIn).toISOString()
          : null,
        seats,
      }}
      canManageLogin={admin.perms.has("platform.users.manage")}
      isSelf={login.id === admin.id}
      shareLink={partnerShareLink(siteUrl(), p.code)}
      tiers={tierNow.rates.tiers.map((t) => t.name)}
      tier={tierNow.tier.name}
      liveChurches={tierNow.liveChurches}
      wallet={wallet}
      churches={churches}
      earnings={earnings.map((e) => ({
        id: e.id,
        kind: e.kind,
        amount: Number(e.amount),
        currency: e.currency,
        rateBps: e.rateBps,
        status: e.status,
        payoutId: e.payoutId,
        churchName: e.churchName,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      }))}
      payouts={payouts.map((x) => ({
        id: x.id,
        amount: Number(x.amount),
        currency: x.currency,
        status: x.status,
        reference: x.reference,
        bankName: x.bankName,
        bankAccountNumber: x.bankAccountNumber,
        requestedAt: x.requestedAt.toISOString(),
        paidAt: x.paidAt?.toISOString() ?? null,
      }))}
      activity={activity.map((a) => ({
        id: a.id,
        summary: a.summary,
        severity: a.severity,
        actorName: a.actorName,
        createdAt: a.createdAt.toISOString(),
      }))}
    />
  );
}
