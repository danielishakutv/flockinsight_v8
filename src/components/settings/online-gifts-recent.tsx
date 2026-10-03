import { CircleAlert, Clock, HandCoins } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { providerName } from "@/lib/gateways/specs";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { getT } from "@/lib/i18n/server";

export type OnlineGiftRow = {
  id: string;
  reference: string;
  provider: string;
  amount: number;
  currency: string;
  status: string;
  giverName: string | null;
  giverEmail: string | null;
  failReason: string | null;
  paidAt: string | null;
  createdAt: string;
  linkTitle: string | null;
};

/**
 * Recent online gifts, including the ones that did not complete.
 *
 * The successful ones are already in the giving records, where they belong —
 * this list exists for the other three outcomes. "Somebody says they gave and
 * it isn't showing" is the support question this module will generate most
 * often, and without this the only answer available is "we have no idea".
 *
 * A pending row is explicitly NOT a failure. Bank transfers clear minutes
 * later, and a church telling a member their gift failed when it is still
 * going through is worse than saying nothing.
 */
export async function OnlineGiftsRecent({
  gifts,
  currency,
}: {
  gifts: OnlineGiftRow[];
  currency: string;
}) {
  // A server component: this table has no interaction, so it ships no JS and
  // reads its words with getT() rather than through the client provider.
  const t = await getT();
  if (gifts.length === 0) return null;

  const pending = gifts.filter((g) => g.status === "pending").length;
  const failed = gifts.filter((g) => g.status === "failed").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <HandCoins className="text-primary size-5" /> Recent online gifts
        </CardTitle>
        <CardDescription>
          Successful gifts are in your giving records already. This also shows
          the ones that never completed, so you can answer somebody who says
          they gave.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {(pending > 0 || failed > 0) && (
          <div className="flex flex-wrap gap-2 text-xs">
            {pending > 0 && (
              <Badge variant="warning" className="gap-1">
                <Clock className="size-3" /> {pending} still going through
              </Badge>
            )}
            {failed > 0 && (
              <Badge variant="secondary" className="gap-1">
                <CircleAlert className="size-3" /> {failed} didn&apos;t complete
              </Badge>
            )}
          </div>
        )}
        <ScrollableTable>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs uppercase">
                <th className="py-2 pr-3 font-semibold">{t("give.colGiver")}</th>
                <th className="py-2 pr-3 font-semibold">{t("give.colFor")}</th>
                <th className="py-2 pr-3 text-right font-semibold">
                  {t("give.colAmount")}
                </th>
                <th className="py-2 pr-3 font-semibold">{t("give.colStatus")}</th>
                <th className="py-2 font-semibold">{t("give.colWhen")}</th>
              </tr>
            </thead>
            <tbody>
              {gifts.map((g) => (
                <tr key={g.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    <p className="font-medium">{g.giverName || "Anonymous"}</p>
                    <p className="text-muted-foreground text-xs break-all">
                      {g.giverEmail}
                    </p>
                  </td>
                  <td className="text-muted-foreground py-2 pr-3">
                    {g.linkTitle ?? "—"}
                    <p className="text-xs">{providerName(g.provider)}</p>
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold whitespace-nowrap">
                    {formatMoney(g.amount, g.currency || currency)}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge
                      variant={
                        g.status === "success"
                          ? "success"
                          : g.status === "pending"
                            ? "warning"
                            : "secondary"
                      }
                    >
                      {g.status === "success"
                        ? "Received"
                        : g.status === "pending"
                          ? "Going through"
                          : "Not completed"}
                    </Badge>
                    {/*
                      The gateway's own words. "Insufficient funds" is
                      something a church can mention kindly; "failed" is not.
                    */}
                    {g.failReason && g.status !== "success" && (
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {g.failReason}
                      </p>
                    )}
                  </td>
                  <td className="text-muted-foreground py-2 text-xs whitespace-nowrap">
                    {new Date(g.paidAt ?? g.createdAt).toLocaleString(undefined, {
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {/* The reference, so a church can find the same payment in
                        its own gateway dashboard. */}
                    <p className="text-[10px] break-all opacity-70">{g.reference}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      </CardContent>
    </Card>
  );
}
