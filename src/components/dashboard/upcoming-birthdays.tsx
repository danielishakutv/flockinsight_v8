import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Cake } from "lucide-react";
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

export async function UpcomingBirthdays({ churchId }: { churchId: string }) {
  const today = new Date();
  // Next 14 days as MM-DD keys (handles month/year rollover naturally).
  const window: { key: string; offset: number; label: string }[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    window.push({
      key: `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      offset: i,
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${MONTHS[d.getMonth()]} ${d.getDate()}`,
    });
  }
  const keys = window.map((w) => w.key);
  const meta = new Map(window.map((w) => [w.key, w]));

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
        inArray(sql`to_char(${member.dateOfBirth}, 'MM-DD')`, keys),
      ),
    )
    .limit(30);

  if (rows.length === 0) return null;

  const people = rows
    .map((r) => {
      const key = (r.dob ?? "").slice(5); // MM-DD
      return { ...r, ...(meta.get(key) ?? { offset: 99, label: "" }) };
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
      </CardContent>
    </Card>
  );
}
