import Link from "next/link";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Cake } from "lucide-react";
import { db } from "@/db";
import { member } from "@/db/schema";
import { celebrationWindow, displayZone, windowLookup } from "@/lib/celebration-window";
import { churchDisplayZone } from "@/lib/celebrations";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function initials(first: string, last: string | null) {
  return [first?.[0], last?.[0]].filter(Boolean).join("").toUpperCase();
}

/**
 * The next fortnight's birthdays, where "Today" is today where the church is.
 *
 * Pass the church's `timezone` when the page already has it; otherwise it is
 * read. The window used to be the server's (UTC) calendar, so a Nairobi church
 * saw yesterday's birthdays as "Today" until 3am — and the cron, which greets
 * by the church's own clock, disagreed with the dashboard about who was due.
 */
export async function UpcomingBirthdays({
  churchId,
  timezone,
}: {
  churchId: string;
  timezone?: string;
}) {
  const tz = timezone !== undefined ? displayZone(timezone) : await churchDisplayZone(churchId);
  // 14 days of MM-DD keys, with 29 Feb landing on the 28th in a common year.
  const meta = windowLookup(celebrationWindow(tz, 14));
  const keys = [...meta.keys()];
  const mmdd = sql<string>`to_char(${member.dateOfBirth}, 'MM-DD')`;
  const todayKey = keys[0];

  const rows = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      dob: member.dateOfBirth,
    })
    .from(member)
    .where(
      and(
        eq(member.churchId, churchId),
        isNotNull(member.dateOfBirth),
        inArray(mmdd, keys),
      ),
    )
    /*
     * Nearest first, IN SQL, so the cap below only ever cuts from the far end
     * of the fortnight. It used to be an unordered LIMIT 30, which in a large
     * church could leave out today's own celebrants. MM-DD from today onwards
     * sorts first; a window running over New Year puts January after it.
     */
    .orderBy(sql`(${mmdd} < ${todayKey})`, asc(mmdd))
    .limit(30);

  if (rows.length === 0) return null;

  const people = rows
    .map((r) => {
      const w = meta.get((r.dob ?? "").slice(5)); // MM-DD
      const offset = w?.offset ?? 99;
      const label = !w
        ? ""
        : offset === 0
          ? "Today"
          : offset === 1
            ? "Tomorrow"
            : `${MONTHS[w.month]} ${w.day}`;
      return { ...r, offset, label };
    })
    .sort((a, b) => a.offset - b.offset)
    .slice(0, 6);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Cake className="text-primary size-5" /> Upcoming birthdays
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {people.map((p) => (
          <div key={p.id} className="flex items-center gap-3">
            <Avatar className="size-9">
              <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                {initials(p.firstName, p.lastName) || "?"}
              </AvatarFallback>
            </Avatar>
            <p className="min-w-0 flex-1 truncate text-sm font-semibold">
              {[p.firstName, p.lastName].filter(Boolean).join(" ")}
            </p>
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
