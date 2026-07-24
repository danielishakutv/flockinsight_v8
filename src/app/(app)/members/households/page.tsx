import Link from "next/link";
import { ArrowLeft, ChevronRight, Home, Users } from "lucide-react";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { listHouseholds } from "@/lib/households";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NewHouseholdButton } from "@/components/members/new-household-button";

export const metadata = { title: "Households" };

export default async function HouseholdsPage() {
  const { church } = await requireChurch();
  await requireCan("members.view");
  const canManage = await can("members.manage");

  const households = await listHouseholds(church.id);

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/members">
          <ArrowLeft className="size-4" />
          Members
        </Link>
      </Button>
      <PageHeader
        title="Households"
        description={`${households.length} household${households.length === 1 ? "" : "s"} — group family members together.`}
        action={canManage ? <NewHouseholdButton /> : undefined}
      />

      {households.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="bg-primary/10 text-primary grid size-14 place-items-center rounded-2xl">
              <Home className="size-7" />
            </div>
            <p className="text-muted-foreground max-w-sm">
              No households yet. Households are optional — create one to group a
              family, or add a member to a household from their profile.
            </p>
            {canManage && <NewHouseholdButton />}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {households.map((h) => (
            <Link
              key={h.id}
              href={`/members/households/${h.id}`}
              className="bg-card hover:border-primary/40 flex items-center gap-3 rounded-2xl border p-3 shadow-sm transition-colors"
            >
              <div className="bg-primary/10 text-primary grid size-11 shrink-0 place-items-center rounded-lg">
                <Home className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{h.name}</p>
                <p className="text-muted-foreground flex items-center gap-1 text-xs">
                  <Users className="size-3.5" />
                  {h.members} member{h.members === 1 ? "" : "s"}
                  {h.children ? ` · ${h.adults} adult${h.adults === 1 ? "" : "s"}, ${h.children} child${h.children === 1 ? "" : "ren"}` : ""}
                  {h.headName ? ` · Head: ${h.headName}` : ""}
                </p>
              </div>
              <ChevronRight className="text-muted-foreground size-5" />
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
