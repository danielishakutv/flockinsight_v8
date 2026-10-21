import type { Metadata } from "next";
import { getAppointmentByToken } from "@/lib/pastoral";
import { formatWhen } from "@/lib/pastoral-messages";
import { icsUid } from "@/lib/pastoral-ics";
import { MAX_SELF_RESCHEDULES, churchZone, holdsTheSlot, locationKey } from "@/lib/pastoral-shared";
import { todayKey } from "@/lib/pastoral-slots";
import { getT } from "@/lib/i18n/server";
import { ManageAppointment } from "@/components/pastoral/manage-appointment";

export const dynamic = "force-dynamic";

/*
 * Never indexed, and no Referer: the token in this URL is the whole of the
 * booker's access, and a link clicked from this page must not carry it to
 * another site's logs.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Somebody's own appointment, by the link in their confirmation.
 *
 * Viewing never acts. Mail scanners open every link in an email, so the page
 * only renders; cancelling and moving are POSTs from the buttons on it.
 */
export default async function ManageAppointmentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getT();
  const found = await getAppointmentByToken(token);
  const now = new Date().getTime();

  const shell = (children: React.ReactNode, churchName?: string, logo?: string | null) => (
    <div className="bg-muted/40 min-h-dvh">
      <div className="mx-auto w-full max-w-xl px-4 py-8 lg:py-12">
        {churchName && (
          <div className="mb-6 flex items-center gap-3">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="size-12 shrink-0 rounded-xl border object-cover" />
            ) : null}
            <p className="font-semibold break-words">{churchName}</p>
          </div>
        )}
        <div className="bg-card rounded-2xl border p-6">{children}</div>
      </div>
    </div>
  );

  if (!found || found.appt.endsAt.getTime() < now) {
    return shell(
      <div className="space-y-2">
        <h1 className="text-xl font-extrabold">{t("pastoral.manage.expired")}</h1>
        <p className="text-muted-foreground text-sm">{t("pastoral.manage.expiredBody")}</p>
      </div>,
    );
  }

  const { appt: a, church: c, page } = found;
  const zone = churchZone(c);
  const where = t(locationKey(a.location));
  const cutoff = page?.changeCutoffHours ?? 2;

  if (!holdsTheSlot(a.status)) {
    return shell(
      <div className="space-y-2">
        <h1 className="text-xl font-extrabold">{t("pastoral.manage.title")}</h1>
        <p className="text-sm">
          {t(a.status === "declined" ? "pastoral.manage.declined" : "pastoral.manage.cancelled")}
        </p>
        <p className="text-muted-foreground text-sm">
          {a.typeName} · {a.pastorName} · {formatWhen(a.startsAt, zone, t.intl)}
        </p>
      </div>,
      c.name,
      c.logo,
    );
  }

  const tooLate = a.startsAt.getTime() - cutoff * 3_600_000 <= now;
  const refusal = tooLate
    ? c.publicPhone
      ? t("pastoral.manage.tooLate", { hours: cutoff, phone: c.publicPhone })
      : t("pastoral.manage.tooLateNoPhone", { hours: cutoff })
    : null;

  return shell(
    <ManageAppointment
      token={token}
      zone={zone}
      today={todayKey(new Date(), zone)}
      status={a.status === "pending" ? "pending" : "confirmed"}
      typeName={a.typeName}
      pastorName={a.pastorName}
      when={formatWhen(a.startsAt, zone, t.intl)}
      where={a.address ? `${where}, ${a.address}` : where}
      refusal={refusal}
      canMove={a.rescheduleCount < MAX_SELF_RESCHEDULES}
      ics={{
        uid: icsUid(a.id),
        sequence: a.rescheduleCount,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        summary: `${a.typeName} · ${a.pastorName}`,
        location: a.address ? `${where}, ${a.address}` : where,
      }}
    />,
    c.name,
    c.logo,
  );
}
