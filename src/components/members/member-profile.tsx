"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Baby, Pencil, ShieldCheck } from "lucide-react";
import { formatBirthday } from "@/lib/birthday";
import {
  memberToForm,
  type Guardian,
} from "@/components/members/member-form-fields";
import { MemberEditForm } from "@/components/members/member-edit-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type MemberRecord = Parameters<typeof memberToForm>[0];

const REL_LABEL: Record<string, string> = {
  son: "Son",
  daughter: "Daughter",
  ward: "Ward",
  dependent: "Dependent",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  visitor: "Visitor",
  new_convert: "New convert",
};
const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "success"
> = {
  active: "success",
  visitor: "secondary",
  new_convert: "default",
  inactive: "outline",
};

function fmtDate(d: string | null) {
  if (!d) return null;
  try {
    return format(parseISO(d), "MMM d, yyyy");
  } catch {
    return d;
  }
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="text-muted-foreground w-40 shrink-0 text-sm">{label}</dt>
      <dd className="text-sm font-medium">{value || "—"}</dd>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-muted-foreground mb-1 text-xs font-bold uppercase tracking-wide">
        {title}
      </p>
      <dl className="divide-y">{children}</dl>
    </div>
  );
}

function MemberView({
  member,
  onEdit,
  canManage,
  isTeamMember,
  guardianName,
}: {
  member: MemberRecord;
  onEdit: () => void;
  canManage: boolean;
  isTeamMember?: boolean;
  guardianName?: string | null;
}) {
  const addressParts = [
    [member.house, member.street].filter(Boolean).join(" "),
    member.city,
    member.lga ? `${member.lga} LGA` : "",
    member.state,
    member.country,
  ].filter(Boolean);
  const address = addressParts.join(", ");
  const gender = member.gender
    ? member.gender.charAt(0).toUpperCase() + member.gender.slice(1)
    : null;

  return (
    <Card>
      <CardContent className="space-y-6 py-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {member.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={member.photoUrl}
                alt=""
                className="size-16 shrink-0 rounded-full border object-cover"
              />
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[member.status] ?? "secondary"}>
                {STATUS_LABEL[member.status] ?? member.status}
              </Badge>
              {member.isMinor && (
                <Badge variant="secondary" className="gap-1">
                  <Baby className="size-3" /> Child
                </Badge>
              )}
              {isTeamMember && (
                <Badge variant="default" className="gap-1">
                  <ShieldCheck className="size-3" /> Team member
                </Badge>
              )}
            </div>
          </div>
          {canManage && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="size-4" />
              Edit
            </Button>
          )}
        </div>

        {(member.phone || member.email) && (
          <Section title="Contact">
            <Row label="Phone" value={member.phone} />
            <Row label="Email" value={member.email} />
          </Section>
        )}

        <Section title="Personal">
          <Row label="Gender" value={gender} />
          {member.isMinor && (
            <Row
              label="Guardian"
              value={
                guardianName
                  ? member.relationship
                    ? `${guardianName} · ${REL_LABEL[member.relationship] ?? member.relationship}`
                    : guardianName
                  : "Not linked"
              }
            />
          )}
          <Row
            label="Date of birth"
            value={formatBirthday(member.dateOfBirth) || null}
          />
          <Row label="Date joined" value={fmtDate(member.joinedAt)} />
        </Section>

        {(member.weddingDate ||
          member.baptized ||
          (member.anniversaries?.length ?? 0) > 0) && (
          <Section title="Milestones">
            {member.weddingDate && (
              <Row label="Wedding" value={fmtDate(member.weddingDate)} />
            )}
            <Row
              label="Baptized"
              value={
                member.baptized
                  ? member.baptismDate
                    ? `Yes · ${fmtDate(member.baptismDate)}`
                    : "Yes"
                  : "No"
              }
            />
            {member.anniversaries?.map((a, i) => (
              <Row key={i} label={a.label} value={fmtDate(a.date)} />
            ))}
          </Section>
        )}

        <Section title="Address">
          <Row label="Address" value={address} />
        </Section>

        {member.notes && (
          <Section title="Notes">
            <Row label="Notes" value={member.notes} />
          </Section>
        )}
      </CardContent>
    </Card>
  );
}

export function MemberProfile({
  member,
  canManage = true,
  isTeamMember,
  guardians = [],
  guardianName,
}: {
  member: MemberRecord;
  canManage?: boolean;
  isTeamMember?: boolean;
  guardians?: Guardian[];
  guardianName?: string | null;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");

  return mode === "view" || !canManage ? (
    <MemberView
      member={member}
      canManage={canManage}
      isTeamMember={isTeamMember}
      guardianName={guardianName}
      onEdit={() => setMode("edit")}
    />
  ) : (
    <MemberEditForm
      member={member}
      guardians={guardians}
      onDone={() => setMode("view")}
    />
  );
}
