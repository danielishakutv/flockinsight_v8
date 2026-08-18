import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import {
  denominationChurches,
  getDenomination,
  suggestedChurches,
} from "@/lib/denominations";
import { DenominationChurches } from "@/components/superadmin/denomination-churches";

export const metadata = { title: "Denomination · Admin" };
export const dynamic = "force-dynamic";

export default async function DenominationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const record = await getDenomination(id);
  if (!record) notFound();

  const [{ members, unassigned }, suggested] = await Promise.all([
    denominationChurches(id),
    suggestedChurches(record.name, record.abbreviation),
  ]);

  return (
    <div className="space-y-5">
      <Link
        href="/superadmin/denominations"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-[13px] font-medium"
      >
        <ArrowLeft className="size-3.5" /> All denominations
      </Link>

      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {record.name}
          {record.abbreviation ? (
            <span className="text-muted-foreground font-normal">
              {" "}
              · {record.abbreviation}
            </span>
          ) : null}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {members.length} church{members.length === 1 ? "" : "es"} grouped here.
          {record.notes ? ` ${record.notes}` : ""}
        </p>
      </div>

      <DenominationChurches
        denominationId={id}
        members={members}
        unassigned={unassigned}
        suggested={suggested}
      />
    </div>
  );
}
