"use client";

import { format, parseISO } from "date-fns";
import { BadgeCheck, IdCard, Mail, Phone, ShieldAlert } from "lucide-react";
import { ContactActions } from "@/components/superadmin/contact-actions";
import {
  VERIFICATION_LABEL,
  verificationState,
} from "@/lib/verification-shared";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const KYC_LABEL: Record<string, string> = {
  not_started: "Not started",
  pending: "Awaiting review",
  approved: "Approved",
  rejected: "Rejected",
};

/**
 * The church's account contact details and where it stands on verification.
 *
 * Read-only on purpose: an operator marking a church verified by hand would
 * defeat the point of the code. What this card is for is knowing who to
 * contact and whether they've proved they own it.
 */
export function ChurchVerificationCard({
  contactEmail,
  contactPhone,
  emailVerifiedAt,
  phoneVerifiedAt,
  kycStatus,
}: {
  contactEmail: string | null;
  contactPhone: string | null;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  kycStatus: string;
}) {
  const fields = { contactEmail, contactPhone, emailVerifiedAt, phoneVerifiedAt };
  const state = verificationState(fields);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          {state === "verified" ? (
            <BadgeCheck className="size-5 fill-sky-500 text-white" />
          ) : (
            <ShieldAlert className="text-amber-500 size-5" />
          )}
          Verification
          <Badge
            variant={
              state === "verified"
                ? "success"
                : state === "partial"
                  ? "warning"
                  : "secondary"
            }
          >
            {VERIFICATION_LABEL[state]}
          </Badge>
        </CardTitle>
        <CardDescription>
          The church&apos;s own account contacts — how we reach them, and what
          they&apos;ve proved they own.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Row
          icon={Mail}
          label="Account email"
          value={contactEmail}
          verifiedAt={emailVerifiedAt}
        />
        <Row
          icon={Phone}
          label="Account phone"
          value={contactPhone}
          verifiedAt={phoneVerifiedAt}
        />
        <ContactActions email={contactEmail} phone={contactPhone} />
        <div className="text-muted-foreground flex items-center gap-2 border-t pt-3 text-sm">
          <IdCard className="size-4 shrink-0" />
          <span>ID check (KYC)</span>
          <Badge variant="secondary" className="ml-auto">
            {KYC_LABEL[kycStatus] ?? kycStatus}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  verifiedAt,
}: {
  icon: typeof Mail;
  label: string;
  value: string | null;
  verifiedAt: string | null;
}) {
  const ok = !!value && !!verifiedAt;
  return (
    <div className="flex flex-wrap items-start gap-2">
      <div
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          ok ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
          {label}
        </p>
        <p className="truncate text-sm font-medium">
          {value ?? <span className="text-muted-foreground italic">Not set</span>}
        </p>
      </div>
      <Badge variant={ok ? "success" : "warning"} className="shrink-0">
        {ok
          ? `Verified ${format(parseISO(verifiedAt), "MMM d, yyyy")}`
          : "Unverified"}
      </Badge>
    </div>
  );
}
