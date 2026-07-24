import Link from "next/link";
import { UsersRound } from "lucide-react";
import type { MemberBreakdown } from "@/lib/dashboard-data";
import { CategoryDonut } from "@/components/charts/category-donut";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** One row of the status split — a labelled proportional bar. */
function StatusBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {value.toLocaleString()} · {pct}%
        </span>
      </div>
      <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

/**
 * Who's in the congregation: the gender split as a donut, plus how people are
 * classified and how many we can actually reach.
 */
export function PeopleSnapshot({ data }: { data: MemberBreakdown }) {
  const donut = [
    { name: "Men", value: data.male, color: "var(--chart-1)" },
    { name: "Women", value: data.female, color: "var(--chart-5)" },
    { name: "Not recorded", value: data.unknownGender, color: "var(--chart-3)" },
  ].filter((d) => d.value > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <UsersRound className="text-primary size-5" /> Your people
        </CardTitle>
        <CardDescription>
          {data.total.toLocaleString()} member
          {data.total === 1 ? "" : "s"} on record
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">
        {donut.length > 0 ? (
          <CategoryDonut data={donut} />
        ) : (
          <p className="text-muted-foreground self-center text-sm">
            Add members to see the gender split.
          </p>
        )}

        <div className="space-y-3 self-center">
          <StatusBar
            label="Active members"
            value={data.active}
            total={data.total}
            color="var(--chart-1)"
          />
          <StatusBar
            label="Visitors"
            value={data.visitors}
            total={data.total}
            color="var(--chart-2)"
          />
          <StatusBar
            label="New converts"
            value={data.newConverts}
            total={data.total}
            color="var(--chart-4)"
          />
          <StatusBar
            label="Inactive"
            value={data.inactive}
            total={data.total}
            color="var(--chart-3)"
          />
          <p className="text-muted-foreground border-t pt-3 text-xs">
            {data.adults.toLocaleString()} adult
            {data.adults === 1 ? "" : "s"} · {data.children.toLocaleString()}{" "}
            child{data.children === 1 ? "" : "ren"}. Reachable:{" "}
            {data.withPhone.toLocaleString()} by SMS ·{" "}
            {data.withEmail.toLocaleString()} by email.{" "}
            <Link href="/members" className="text-primary font-medium underline">
              Manage members
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
