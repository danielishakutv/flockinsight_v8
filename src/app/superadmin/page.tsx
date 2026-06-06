import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { format } from "date-fns";
import {
  Building2,
  ClipboardCheck,
  PauseCircle,
  UserRound,
  Users,
} from "lucide-react";
import { db } from "@/db";
import { church, member, user, attendanceSession } from "@/db/schema";
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
  const [
    [{ churches }],
    [{ suspended }],
    [{ users }],
    [{ members }],
    [{ sessions }],
    recent,
  ] = await Promise.all([
    db.select({ churches: count() }).from(church),
    db
      .select({ suspended: count() })
      .from(church)
      .where(eq(church.status, "suspended")),
    db.select({ users: count() }).from(user),
    db.select({ members: count() }).from(member),
    db.select({ sessions: count() }).from(attendanceSession),
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
      .limit(8),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
          Platform overview
        </h1>
        <p className="text-muted-foreground mt-1">
          All churches and accounts on FlockInsight.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Churches" value={churches} icon={Building2} accent />
        <StatCard label="Suspended" value={suspended} icon={PauseCircle} />
        <StatCard label="Accounts" value={users} icon={UserRound} />
        <StatCard label="Members" value={members} icon={Users} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard
          label="Attendance records"
          value={sessions}
          icon={ClipboardCheck}
        />
      </div>

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
        <CardContent className="space-y-2">
          {recent.length === 0 ? (
            <p className="text-muted-foreground text-sm">No churches yet.</p>
          ) : (
            recent.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-xl px-2 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">{c.name}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    /{c.slug} · joined {format(c.createdAt, "MMM d, yyyy")}
                  </p>
                </div>
                <Badge
                  variant={c.status === "suspended" ? "destructive" : "success"}
                  className="capitalize"
                >
                  {c.status}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
