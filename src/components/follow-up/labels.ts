export type FollowUpStatus =
  | "new"
  | "contacted"
  | "in_progress"
  | "joined"
  | "not_interested";

export type InteractionType =
  | "visit"
  | "call"
  | "sms"
  | "whatsapp"
  | "email"
  | "note";

export type InteractionOutcome =
  | "reached"
  | "no_response"
  | "scheduled"
  | "not_interested";

export type BadgeVariant = "default" | "secondary" | "outline" | "success";

export const STATUS_LABEL: Record<FollowUpStatus, string> = {
  new: "New",
  contacted: "Contacted",
  in_progress: "In progress",
  joined: "Joined",
  not_interested: "Not interested",
};

export const STATUS_VARIANT: Record<FollowUpStatus, BadgeVariant> = {
  new: "secondary",
  contacted: "default",
  in_progress: "default",
  joined: "success",
  not_interested: "outline",
};

export const STATUS_ORDER: FollowUpStatus[] = [
  "new",
  "contacted",
  "in_progress",
  "joined",
  "not_interested",
];

export const TYPE_LABEL: Record<InteractionType, string> = {
  visit: "Visit",
  call: "Call",
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
  note: "Note",
};

export const OUTCOME_LABEL: Record<InteractionOutcome, string> = {
  reached: "Reached",
  no_response: "No response",
  scheduled: "Scheduled",
  not_interested: "Not interested",
};

/** A member's follow-up status, treating an unset value as "new". */
export function effectiveStatus(s: FollowUpStatus | null): FollowUpStatus {
  return s ?? "new";
}
