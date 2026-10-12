import Link from "next/link";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { Heart } from "lucide-react";
import { db } from "@/db";
import { member } from "@/db/schema";
import {
  celebrationWindow,
  displayZone,
  windowLookup,
  yearsTo,
} from "@/lib/celebration-window";
import { churchDisplayZone } from "@/lib/celebrations";
import { customAnniversaryOn } from "@/lib/celebration-sql";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function initials(first: string, last: string | null) {
  return [first?.[0], last?.[0]].filter(Boolean).join("").toUpperCase();
}

type Event = {
  id: string;
  name: string;
  first: string;
  last: string | null;
  kind: string; // "Wedding" | "Baptism" | custom label
  offset: number;
  label: string;
  years: number | null;
};

/**
 * The next fortnight's wedding, baptism and custom anniversaries, in the
 * church's own calendar (see UpcomingBirthdays).
 */
export async function UpcomingAnniversaries({
  churchId,
  timezone,
}: {
  churchId: string;
  timezone?: string;
}) {
  const tz = timezone !== undefined ? displayZone(timezone) : await churchDisplayZone(churchId);
  const meta = windowLookup(celebrationWindow(tz, 14));
  const keys = [...meta.keys()];

  /*
   * Candidates are filtered by the window IN SQL. This used to load any 500
   * members with a wedding or baptism date, in no order, and filter in JS
   * afterwards — so a church with 1,500 married or baptised members missed
   * about two thirds of its anniversaries. Custom anniversaries are matched on
   * the window in SQL too, so none of them can crowd the others out of the cap.
   */
  const rows = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      weddingDate: member.weddingDate,
      baptismDate: member.baptismDate,
      anniversaries: member.anniversaries,
    })
    .from(member)
    .where(
      and(
        eq(member.churchId, churchId),
        or(
          inArray(sql`to_char(${member.weddingDate}, 'MM-DD')`, keys),
          inArray(sql`to_char(${member.baptismDate}, 'MM-DD')`, keys),
          customAnniversaryOn(keys),
        ),
      ),
    )
    .limit(2000);

  const events: Event[] = [];
  const add = (
    r: (typeof rows)[number],
    iso: string | null,
    kind: string,
  ) => {
    if (!iso) return;
    const m = meta.get(iso.slice(5)); // MM-DD
    if (!m) return;
    events.push({
      id: `${r.id}-${kind}`,
      name: [r.firstName, r.lastName].filter(Boolean).join(" "),
      first: r.firstName,
      last: r.lastName,
      kind,
      offset: m.offset,
      label:
        m.offset === 0
          ? "Today"
          : m.offset === 1
            ? "Tomorrow"
            : `${MONTHS[m.month]} ${m.day}`,
      years: yearsTo(iso, m.year),
    });
  };

  for (const r of rows) {
    add(r, r.weddingDate, "Wedding");
    add(r, r.baptismDate, "Baptism");
    for (const a of r.anniversaries ?? []) add(r, a.date, a.label);
  }

  if (events.length === 0) return null;
  const people = events.sort((a, b) => a.offset - b.offset).slice(0, 6);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Heart className="text-primary size-5" /> Upcoming anniversaries
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {people.map((p) => (
          <div key={p.id} className="flex items-center gap-3">
            <Avatar className="size-9">
              <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                {initials(p.first, p.last) || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{p.name}</p>
              <p className="text-muted-foreground truncate text-xs">
                {p.kind}
                {p.years ? ` · ${p.years} yr${p.years === 1 ? "" : "s"}` : ""}
              </p>
            </div>
            <span
              className={
                "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold " +
                (p.offset === 0
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground")
              }
            >
              {p.label}
            </span>
          </div>
        ))}
        <Link
          href="/celebrations"
          className="text-primary block pt-1 text-xs font-semibold hover:underline"
        >
          View all celebrations →
        </Link>
      </CardContent>
    </Card>
  );
}
