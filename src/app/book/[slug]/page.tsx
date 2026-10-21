import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBookingPageBySlug, listPastors, listTypes } from "@/lib/pastoral";
import { churchZone } from "@/lib/pastoral-shared";
import { todayKey } from "@/lib/pastoral-slots";
import { memberTicketSecret } from "@/lib/pastoral-tokens";
import { getT } from "@/lib/i18n/server";
import { PublicBookingFlow } from "@/components/pastoral/public-booking-flow";

export const dynamic = "force-dynamic";

/**
 * A church's pastor booking page.
 *
 * `getBookingPageBySlug` returns null for an unknown slug, a switched-off
 * page, a church whose plan does not include the module and one whose
 * automations are paused, so all four land on the same 404. A different
 * answer for each would make this URL a way to discover which churches are
 * on the platform.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getBookingPageBySlug(slug);
  const t = await getT();
  if (!data) return { title: t("pastoral.public.unavailable"), robots: { index: false, follow: false } };
  return {
    title: `${data.page.title} · ${data.church.name}`,
    description: data.page.intro,
    // Never indexed: it writes into a pastor's diary, and an indexed page
    // collects strangers.
    robots: { index: false, follow: false },
  };
}

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getBookingPageBySlug(slug);
  if (!data) notFound();
  const { page, church: c } = data;

  const [pastors, types] = await Promise.all([
    listPastors(c.id, { bookableOnly: true }),
    listTypes(c.id, { activeOnly: true }),
  ]);
  // Only what a stranger needs: never a login id, an email or a phone.
  const offered = types.filter((ty) => pastors.some((p) => p.typeIds.includes(ty.id)));
  const zone = churchZone(c);

  return (
    <div className="bg-muted/40 min-h-dvh">
      <div className="mx-auto w-full max-w-xl px-4 py-8 lg:py-12">
        <div className="mb-6 flex items-center gap-3">
          {c.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.logo} alt="" className="size-12 shrink-0 rounded-xl border object-cover" />
          ) : null}
          <p className="font-semibold break-words">{c.name}</p>
        </div>

        <div className="bg-card border-t-primary mb-4 rounded-2xl border border-t-4 p-6">
          <h1 className="text-2xl font-extrabold tracking-tight break-words">{page.title}</h1>
          <p className="text-muted-foreground mt-2 break-words whitespace-pre-wrap">{page.intro}</p>
        </div>

        <div className="bg-card rounded-2xl border p-4 sm:p-6">
          <PublicBookingFlow
            slug={slug}
            churchName={c.name}
            publicPhone={c.publicPhone}
            zone={zone}
            today={todayKey(new Date(), zone)}
            membersOnly={page.visibility === "members"}
            membersUnavailable={page.visibility === "members" && !memberTicketSecret()}
            types={offered.map((ty) => ({
              id: ty.id,
              name: ty.name,
              description: ty.description,
              durationMinutes: ty.durationMinutes,
              location: ty.location,
              requiresApproval: ty.requiresApproval,
            }))}
            pastors={pastors.map((p) => ({
              id: p.id,
              displayName: p.displayName,
              title: p.title,
              typeIds: p.typeIds.filter((id) => offered.some((ty) => ty.id === id)),
              slotMinutes: p.slotMinutes,
            }))}
          />
        </div>
      </div>
    </div>
  );
}
