import { redirect } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { event, eventGuest, form } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, getAccess } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";
import { smsAvailableForCountry } from "@/lib/sms-availability";
import { EventsManager } from "@/components/events/events-manager";
import type { Guest } from "@/components/events/event-guests-dialog";
import type { EventForm } from "@/components/events/event-forms-dialog";

export const metadata = { title: "Events" };

export default async function MyEventsPage() {
  const { church } = await requireChurch();
  if (!(await can("settings.manage"))) redirect("/dashboard");
  const access = await getAccess();
  const canManageForms = access.isOwner || access.perms.has("forms.manage");

  const [rows, guestRows, formRows] = await Promise.all([
    db
      .select()
      .from(event)
      .where(eq(event.churchId, church.id))
      .orderBy(desc(event.date))
      .limit(200),
    db
      .select({
        id: eventGuest.id,
        eventId: eventGuest.eventId,
        name: eventGuest.name,
        role: eventGuest.role,
        email: eventGuest.email,
        phone: eventGuest.phone,
      })
      .from(eventGuest)
      .where(eq(eventGuest.churchId, church.id))
      .orderBy(asc(eventGuest.createdAt)),
    db
      .select({
        id: form.id,
        title: form.title,
        slug: form.slug,
        status: form.status,
        responseCount: form.responseCount,
        eventId: form.eventId,
      })
      .from(form)
      .where(eq(form.churchId, church.id))
      .orderBy(desc(form.updatedAt)),
  ]);

  const guestsByEvent: Record<string, Guest[]> = {};
  for (const g of guestRows) {
    (guestsByEvent[g.eventId] ??= []).push({
      id: g.id,
      name: g.name,
      role: g.role,
      email: g.email,
      phone: g.phone,
    });
  }

  // Forms attached to each event, plus the unlinked forms available to attach.
  const formsByEvent: Record<string, EventForm[]> = {};
  const unlinkedForms: { id: string; title: string }[] = [];
  for (const f of formRows) {
    const lite: EventForm = {
      id: f.id,
      title: f.title,
      slug: f.slug,
      status: f.status,
      responseCount: f.responseCount,
    };
    if (f.eventId) (formsByEvent[f.eventId] ??= []).push(lite);
    else unlinkedForms.push({ id: f.id, title: f.title });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8">
      <div className="mb-4">
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
          Events
        </h1>
        <p className="text-muted-foreground mt-1">
          Create events with flyers and choose which appear publicly.
        </p>
      </div>
      <EventsManager
        baseUrl={siteUrl()}
        publicEnabled={church.publicEnabled}
        guestsByEvent={guestsByEvent}
        formsByEvent={formsByEvent}
        unlinkedForms={unlinkedForms}
        canManageForms={canManageForms}
        smsAvailable={smsAvailableForCountry(church.country)}
        events={rows.map((e) => ({
          id: e.id,
          title: e.title,
          description: e.description,
          flyerUrl: e.flyerUrl,
          date: e.date,
          startTime: e.startTime,
          endTime: e.endTime,
          venue: e.venue,
          address: e.address,
          isPublic: e.isPublic,
        }))}
      />
    </div>
  );
}
