"use client";

import { Mail, Phone, UserCog } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ContactActions } from "@/components/superadmin/contact-actions";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type TeamMemberRow = {
  name: string;
  /** Login email — always present; it's how the account is identified. */
  email: string;
  /**
   * From this person's member record, when their login is linked to one.
   * Most staff have one; a login created straight from an invitation may not.
   */
  phone: string | null;
  baseRole: string;
  customRole: string | null;
  joinedAt: string | null;
};

/**
 * A church's team, as support sees it: every way to reach a person, one tap
 * away. The point of this card is the moment a church is on fire and you need
 * to ring their pastor — not to admire the org chart.
 */
export function ChurchTeam({ team }: { team: TeamMemberRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <UserCog className="text-primary size-5" /> Team ({team.length})
        </CardTitle>
        <CardDescription>
          Call or text on a phone; tap to copy on a computer.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {team.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nobody on the team yet.
          </p>
        ) : (
          team.map((t, i) => (
            <div key={i} className="space-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{t.name}</p>
                  {t.joinedAt && (
                    <p className="text-muted-foreground text-xs">
                      Joined {format(parseISO(t.joinedAt), "MMM d, yyyy")}
                    </p>
                  )}
                </div>
                <Badge
                  variant={t.baseRole === "owner" ? "default" : "secondary"}
                  className="shrink-0 capitalize"
                >
                  {t.baseRole === "owner" ? "Owner" : (t.customRole ?? t.baseRole)}
                </Badge>
              </div>

              <div className="space-y-1 text-sm">
                <p className="text-muted-foreground flex min-w-0 items-center gap-1.5">
                  <Mail className="size-3.5 shrink-0" />
                  <span className="truncate">{t.email}</span>
                </p>
                <p className="text-muted-foreground flex min-w-0 items-center gap-1.5">
                  <Phone className="size-3.5 shrink-0" />
                  {t.phone ? (
                    <span className="truncate">{t.phone}</span>
                  ) : (
                    <span className="italic">
                      No phone on their member record
                    </span>
                  )}
                </p>
              </div>

              <ContactActions email={t.email} phone={t.phone} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
