import Link from "next/link";
import {
  BookOpen,
  CalendarDays,
  FileText,
  FolderOpen,
  HeartHandshake,
  MessagesSquare,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { ModuleHighlights as Highlights } from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Tile = {
  label: string;
  value: number;
  sub: string;
  href: string;
  icon: LucideIcon;
  tile: string;
  /** Permission needed to see this tile. */
  perm?: string;
};

/**
 * A headline number from each module, so the dashboard answers "what's
 * happening across my church?" without a tour of every screen. Tiles link
 * through to their module — they're data, not a second navigation bar.
 */
export function ModuleHighlights({
  data,
  perms,
  isOwner,
  periodLabel,
}: {
  data: Highlights;
  perms: string[];
  isOwner: boolean;
  periodLabel: string;
}) {
  const tiles: Tile[] = [
    {
      label: "Groups",
      value: data.groups,
      sub: "Active ministries",
      href: "/groups",
      icon: UsersRound,
      tile: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
      perm: "groups.view",
    },
    {
      label: "Follow-up",
      value: data.followUpOpen,
      sub: "People still open",
      href: "/follow-up",
      icon: HeartHandshake,
      tile: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
      perm: "followup.view",
    },
    {
      label: "Form responses",
      value: data.formResponses,
      sub: `${periodLabel} · ${data.forms} form${data.forms === 1 ? "" : "s"} open`,
      href: "/forms",
      icon: FileText,
      tile: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
      perm: "forms.view",
    },
    {
      label: "Messages sent",
      value: data.messagesSent,
      sub: data.messagesFailed
        ? `${periodLabel} · ${data.messagesFailed} failed`
        : periodLabel,
      href: "/communication/history",
      icon: MessagesSquare,
      tile: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
      perm: "communication.view",
    },
    {
      label: "Media files",
      value: data.mediaFiles,
      sub: "Sermons, photos & files",
      href: "/media",
      icon: FolderOpen,
      tile: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
      perm: "media.view",
    },
    {
      label: "Subscribers",
      value: data.subscribers,
      sub: "Devotionals & newsletters",
      href: "/devotionals/subscribers",
      icon: BookOpen,
      tile: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
      perm: "devotionals.view",
    },
    {
      label: "Upcoming events",
      value: data.upcomingEvents,
      sub: "Today onwards",
      href: "/my-events",
      icon: CalendarDays,
      tile: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
      perm: "settings.manage",
    },
  ];

  const visible = tiles.filter(
    (t) => isOwner || !t.perm || perms.includes(t.perm),
  );
  if (visible.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Across your church</CardTitle>
        <CardDescription>Tap any number to open that module</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {visible.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="hover:bg-accent flex flex-col gap-1.5 rounded-xl border p-3 transition-colors"
          >
            <span
              className={cn(
                "grid size-8 place-items-center rounded-lg",
                t.tile,
              )}
            >
              <t.icon className="size-4" />
            </span>
            <span className="text-2xl font-extrabold leading-none tabular-nums">
              {t.value.toLocaleString()}
            </span>
            <span className="text-sm font-semibold leading-tight">
              {t.label}
            </span>
            <span className="text-muted-foreground text-xs leading-tight">
              {t.sub}
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
