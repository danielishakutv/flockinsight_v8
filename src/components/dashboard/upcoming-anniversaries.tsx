import Link from "next/link";
import { and, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { Heart } from "lucide-react";
import { db } from "@/db";
import { member } from "@/db/schema";
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

/** Whole years between an ISO date and the given upcoming year, or null. */
function yearsTo(iso: string, eventYear: number): number | null {
  const y = Number(iso.slice(0, 4));
  if (!y) return null;
  const n = eventYear - y;
  return n > 0 ? n : null;
}

export async function UpcomingAnniversaries({ churchId }: { churchId: string }) {
  const today = new Date();
  // Next 14 days, keyed by MM-DD (handles month/year rollover).
  const window: { key: string; offset: number; label: string; year: number }[] =
    [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    window.push({
      key: `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      offset: i,
      label:
        i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${MONTHS[d.getMonth()]} ${d.getDate()}`,
      year: d.getFullYear(),
    });
  }
  const meta = new Map(window.map((w) => [w.key, w]));

  // Candidates: anyone with a wedding/baptism date, or custom anniversaries.
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
          isNotNull(member.weddingDate),
          isNotNull(member.baptismDate),
          ne(sql`jsonb_array_length(${member.anniversaries})`, 0),
        ),
      ),
    )
    .limit(500);

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
      label: m.label,
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
