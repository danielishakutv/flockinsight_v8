import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { event } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";
import { EventsManager } from "@/components/events/events-manager";

export const metadata = { title: "Events" };

export default async function MyEventsPage() {
  const { church } = await requireChurch();
  if (!(await can("settings.manage"))) redirect("/dashboard");

  const rows = await db
    .select()
    .from(event)
    .where(eq(event.churchId, church.id))
    .orderBy(desc(event.date))
    .limit(200);

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
