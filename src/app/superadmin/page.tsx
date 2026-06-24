import Link from "next/link";
import { count, desc, eq, gte, sql } from "drizzle-orm";
import { format } from "date-fns";
import {
  Building2,
  ClipboardCheck,
  HandCoins,
  PauseCircle,
  Sparkles,
  UserCog,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";
import { db } from "@/db";
import {
  church,
  giving,
  group,
  member,
  staff,
  user,
  attendanceSession,
} from "@/db/schema";
import { StatCard } from "@/components/app/stat-card";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Overview · Admin" };

export default async function SuperadminOverviewPage() {
  const now = new Date();
  const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const startOfMonthTs = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    [{ churches }],
    [{ suspended }],
    [{ users }],
    [{ members }],
    [{ staffCount }],
    [{ groups }],
    [{ sessions }],
    [{ givingRecords }],
    [{ newThisMonth }],
    [{ givingThisMonth }],
    recent,
    largest,
  ] = await Promise.all([
    db.select({ churches: count() }).from(church),
    db
      .select({ suspended: count() })
      .from(church)
      .where(eq(church.status, "suspended")),
    db.select({ users: count() }).from(user),
    db.select({ members: count() }).from(member),
    db.select({ staffCount: count() }).from(staff),
    db.select({ groups: count() }).from(group),
    db.select({ sessions: count() }).from(attendanceSession),
    db.select({ givingRecords: count() }).from(giving),
    db
      .select({ newThisMonth: count() })
      .from(church)
      .where(gte(church.createdAt, startOfMonthTs)),
    db
      .select({ givingThisMonth: count() })
      .from(giving)
      .where(gte(giving.date, startOfMonth)),
    db
      .select({
        id: church.id,
        name: church.name,
        slug: church.slug,
        status: church.status,
        createdAt: church.createdAt,
      })
      .from(church)
      .orderBy(desc(church.createdAt))
      .limit(6),
    db
      .select({
        id: church.id,
        name: church.name,
        status: church.status,
        members: count(member.id),
      })
      .from(church)
      .leftJoin(member, eq(member.churchId, church.id))
      .groupBy(church.id)
      .orderBy(desc(count(member.id)))
      .limit(6),
  ]);

  const active = Number(churches) - Number(suspended);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
          Platform overview
        </h1>
        <p className="text-muted-foreground mt-1">
          Health and growth across every church on FlockInsight.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Churches" value={churches} icon={Building2} accent />
        <StatCard
          label="New this month"
          value={newThisMonth}
          icon={Sparkles}
        />
        <StatCard label="Active" value={active} icon={Building2} />
        <StatCard label="Suspended" value={suspended} icon={PauseCircle} />
        <StatCard label="Accounts" value={users} icon={UserRound} />
        <StatCard label="Team members" value={staffCount} icon={UserCog} />
        <StatCard label="Congregation" value={members} icon={Users} />
        <StatCard label="Groups" value={groups} icon={UsersRound} />
        <StatCard
          label="Services recorded"
          value={sessions}
          icon={ClipboardCheck}
        />
        <StatCard
          label="Giving records"
          value={givingRecords}
          sub={`${givingThisMonth} this month`}
          icon={HandCoins}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Largest churches */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Largest churches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {largest.length === 0 ? (
              <p className="text-muted-foreground text-sm">No churches yet.</p>
            ) : (
              largest.map((c, i) => (
                <Link
                  key={c.id}
                  href={`/superadmin/churches/${c.id}`}
                  className="hover:bg-accent flex items-center gap-3 rounded-xl px-2 py-2"
                >
                  <span className="text-muted-foreground w-5 text-sm font-bold tabular-nums">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {c.name}
                  </span>
                  <span className="text-sm font-bold tabular-nums">
                    {Number(c.members)}
                  </span>
                  <span className="text-muted-foreground text-xs">members</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Newest churches */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-lg">Newest churches</CardTitle>
            <Link
              href="/superadmin/churches"
              className="text-primary text-sm font-semibold hover:underline"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent className="space-y-1">
            {recent.length === 0 ? (
              <p className="text-muted-foreground text-sm">No churches yet.</p>
            ) : (
              recent.map((c) => (
                <Link
                  key={c.id}
                  href={`/superadmin/churches/${c.id}`}
                  className="hover:bg-accent flex items-center justify-between gap-3 rounded-xl px-2 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{c.name}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      /{c.slug} · joined {format(c.createdAt, "MMM d, yyyy")}
                    </p>
                  </div>
                  <Badge
                    variant={
                      c.status === "suspended" ? "destructive" : "success"
                    }
                    className="capitalize"
                  >
                    {c.status}
                  </Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
