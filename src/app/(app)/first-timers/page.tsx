import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import {
  ensureFirstTimerSignup,
  listFirstTimers,
  welcomeUrl,
} from "@/lib/first-timer-intake";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { PlanGate } from "@/components/app/plan-gate";
import { RegisterFirstTimer } from "@/components/first-timers/register-first-timer";
import {
  FirstTimersList,
  type FirstTimerRow,
} from "@/components/first-timers/first-timers-list";
import { WelcomeLinkCard } from "@/components/first-timers/welcome-link-card";

export const metadata = { title: "First-timers" };

/** Always current — somebody registered at the door should be here on reload. */
export const dynamic = "force-dynamic";

/**
 * First-time worshippers, with a door of their own.
 *
 * This page exists because of one sentence from a church: "Can we have
 * registration of first-time worshippers on its own, not under membership,
 * because it's really making my people confused and they are messing up the
 * thing." See `lib/first-timer-intake.ts` for what the mess actually was.
 */
export default async function FirstTimersPage() {
  const { church } = await requireChurch();
  await requireCan("followup.view");
  const canManage = await can("followup.manage");

  const [people, memberOptions, signup] = await Promise.all([
    listFirstTimers(church.id),
    // The register, for "who invited them". Active members only: the person
    // who brought a visitor is nearly always a settled member, and offering
    // every visitor as a possible inviter makes the list unusable.
    db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
      })
      .from(member)
      .where(and(eq(member.churchId, church.id), eq(member.status, "active")))
      .orderBy(asc(member.firstName), asc(member.lastName))
      .limit(5000),
    canManage
      ? ensureFirstTimerSignup({
          id: church.id,
          name: church.name,
          handle: church.handle ?? null,
        })
      : null,
  ]);

  const rows: FirstTimerRow[] = people.map((p) => ({
    id: p.id,
    name: [p.firstName, p.lastName].filter(Boolean).join(" "),
    phone: p.phone,
    email: p.email,
    status: p.status,
    firstVisitDate: p.firstVisitDate,
    invitedBy:
      [p.inviterFirstName, p.inviterLastName].filter(Boolean).join(" ") ||
      p.invitedByName ||
      null,
    inFollowUp: p.inFollowUp,
    followUpStatus: p.followUpStatus,
  }));

  const members = memberOptions.map((m) => ({
    id: m.id,
    name: [m.firstName, m.lastName].filter(Boolean).join(" "),
  }));

  return (
    <PageContainer>
      <PlanGate feature="followUp" />

      <PageHeader
        title="First-timers"
        description="Everyone who has worshipped with you for the first time. They go on your register as visitors and into follow-up — and they are in Members too, exactly as before."
        action={canManage ? <RegisterFirstTimer members={members} /> : null}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <FirstTimersList rows={rows} />
        {canManage && signup && (
          <WelcomeLinkCard
            url={welcomeUrl(signup.slug)}
            enabled={signup.enabled}
            churchName={church.name}
          />
        )}
      </div>
    </PageContainer>
  );
}
