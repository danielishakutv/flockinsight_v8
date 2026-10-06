import { listRoadmap, platformSize } from "@/lib/roadmap";
import {
  RoadmapList,
  type TaskItem,
} from "@/components/superadmin/roadmap-list";
import { Card, CardContent } from "@/components/ui/card";

import { requirePlatform } from "@/lib/platform-access";
export const metadata = { title: "Roadmap · Admin" };

/** Always current — an item added on a phone should be there on the next load. */
export const dynamic = "force-dynamic";

export default async function SuperadminRoadmapPage() {
  await requirePlatform("platform.growth.manage");
  const [rows, size] = await Promise.all([listRoadmap(), platformSize()]);

  const items: TaskItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    detail: r.detail,
    status: r.status,
    priority: r.priority,
    area: r.area,
    isPublic: r.isPublic,
    targetDate: r.targetDate,
    // Dates cross to the client as strings; the list formats them there.
    shippedAt: r.shippedAt ? r.shippedAt.toISOString() : null,
    version: r.version,
    churchesAtShip: r.churchesAtShip,
    usersAtShip: r.usersAtShip,
    membersAtShip: r.membersAtShip,
  }));

  const feedPath = "/api/roadmap";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Roadmap</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What is still to do, and what has shipped. Tap the circle to ship
          something — the date and the size of the platform that day are
          stamped on it as you do.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
              Churches today
            </p>
            <p className="text-xl font-extrabold">{size.churches}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
              Users today
            </p>
            <p className="text-xl font-extrabold">
              {size.users.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
              Members today
            </p>
            <p className="text-xl font-extrabold">
              {size.members.toLocaleString()}
            </p>
          </div>
          <p className="text-muted-foreground min-w-[16rem] flex-1 text-xs">
            These are the numbers frozen onto an item the moment it ships.
            Readable and writable at{" "}
            <code className="bg-muted rounded px-1 py-0.5">{feedPath}</code>{" "}
            with{" "}
            <code className="bg-muted rounded px-1 py-0.5">
              ROADMAP_FEED_KEY
            </code>{" "}
            — which is how a build session adds an item, or ticks one off,
            without anybody opening this page. Without the key the feed shows
            only the items ticked public, and no numbers at all.
          </p>
        </CardContent>
      </Card>

      <RoadmapList items={items} />
    </div>
  );
}
