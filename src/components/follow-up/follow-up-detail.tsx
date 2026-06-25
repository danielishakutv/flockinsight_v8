"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  Home,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Plus,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  assignFollowUp,
  logInteraction,
  sendSmsToMember,
  setFollowUpStatus,
  setInFollowUp,
} from "@/app/(app)/follow-up/actions";
import {
  OUTCOME_LABEL,
  STATUS_LABEL,
  STATUS_ORDER,
  TYPE_LABEL,
  effectiveStatus,
  type FollowUpStatus,
  type InteractionOutcome,
  type InteractionType,
} from "@/components/follow-up/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type FollowUpInteractionRow = {
  id: string;
  type: InteractionType;
  outcome: InteractionOutcome | null;
  notes: string | null;
  occurredAt: string;
  byName: string | null;
};

type MemberInfo = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  memberStatus: "active" | "inactive" | "visitor" | "new_convert";
  followUpStatus: FollowUpStatus | null;
  assignedToId: string | null;
};

const MEMBER_STATUS_LABEL: Record<MemberInfo["memberStatus"], string> = {
  active: "Member",
  inactive: "Inactive",
  visitor: "Visitor",
  new_convert: "New convert",
};

const TYPE_ICON: Record<InteractionType, LucideIcon> = {
  visit: Home,
  call: Phone,
  sms: MessageSquare,
  whatsapp: MessageCircle,
  email: Mail,
  note: StickyNote,
};

// Types you log manually (SMS has its own "Send SMS" flow).
const LOG_TYPES: InteractionType[] = ["visit", "call", "whatsapp", "email", "note"];
const OUTCOME_NONE = "none";
const UNASSIGNED = "unassigned";

function todayLocal() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function FollowUpDetail({
  member,
  interactions,
  team,
  smsEnabled,
  canManage = true,
}: {
  member: MemberInfo;
  interactions: FollowUpInteractionRow[];
  team: { userId: string; name: string }[];
  smsEnabled: boolean;
  canManage?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<FollowUpStatus>(
    effectiveStatus(member.followUpStatus),
  );
  const [assignee, setAssignee] = useState<string>(
    member.assignedToId ?? UNASSIGNED,
  );
  const [, startMeta] = useTransition();

  // Log interaction dialog
  const [logOpen, setLogOpen] = useState(false);
  const [logType, setLogType] = useState<InteractionType>("call");
  // Initialise empty — `openLog()` fills today's date on the client when the
  // dialog opens. Computing `new Date()` during render would diverge between
  // the (UTC) server and the local browser, causing a hydration mismatch.
  const [logDate, setLogDate] = useState("");
  const [logOutcome, setLogOutcome] = useState<string>(OUTCOME_NONE);
  const [logNotes, setLogNotes] = useState("");
  const [savingLog, startLog] = useTransition();

  // SMS dialog
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsMsg, setSmsMsg] = useState("");
  const [sendingSms, startSms] = useTransition();

  function changeStatus(v: string) {
    const next = v as FollowUpStatus;
    const prev = status;
    setStatus(next);
    startMeta(async () => {
      const res = await setFollowUpStatus(member.id, next);
      if (!res.ok) {
        setStatus(prev);
        toast.error(res.error);
      }
    });
  }

  function changeAssignee(v: string) {
    const prev = assignee;
    setAssignee(v);
    startMeta(async () => {
      const res = await assignFollowUp(member.id, v === UNASSIGNED ? null : v);
      if (!res.ok) {
        setAssignee(prev);
        toast.error(res.error);
      }
    });
  }

  function openLog() {
    setLogType("call");
    setLogDate(todayLocal());
    setLogOutcome(OUTCOME_NONE);
    setLogNotes("");
    setLogOpen(true);
  }

  function saveLog() {
    startLog(async () => {
      const res = await logInteraction({
        memberId: member.id,
        type: logType,
        occurredAt: logDate,
        outcome: logOutcome === OUTCOME_NONE ? "" : logOutcome,
        notes: logNotes,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Interaction logged");
      setLogOpen(false);
      router.refresh();
    });
  }

  function sendSms() {
    startSms(async () => {
      const res = await sendSmsToMember({ memberId: member.id, message: smsMsg });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("SMS sent");
      setSmsOpen(false);
      setSmsMsg("");
      router.refresh();
    });
  }

  function removeFromFollowUp() {
    startMeta(async () => {
      const res = await setInFollowUp(member.id, false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Removed from follow-up");
      router.push("/follow-up");
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-5 py-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-extrabold">{member.name}</h1>
              <p className="text-muted-foreground truncate text-sm">
                {member.phone || "No phone"}
                {member.email ? ` · ${member.email}` : ""}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0">
              {MEMBER_STATUS_LABEL[member.memberStatus]}
            </Badge>
          </div>

          {canManage && (
          <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={changeStatus}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Assigned to</Label>
              <Select value={assignee} onValueChange={changeAssignee}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {team.map((t) => (
                    <SelectItem key={t.userId} value={t.userId}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={openLog}>
              <Plus className="size-4" />
              Log interaction
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSmsMsg("");
                setSmsOpen(true);
              }}
              disabled={!smsEnabled || !member.phone}
            >
              <MessageSquare className="size-4" />
              Send SMS
            </Button>
          </div>
          {!smsEnabled && (
            <p className="text-muted-foreground text-xs">
              SMS isn&apos;t configured on the server yet.
            </p>
          )}
          </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-6">
          <p className="text-muted-foreground mb-4 text-xs font-bold uppercase tracking-wide">
            History
          </p>
          {interactions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No interactions logged yet.
            </p>
          ) : (
            <ul className="space-y-4">
              {interactions.map((it) => {
                const Icon = TYPE_ICON[it.type];
                return (
                  <li key={it.id} className="flex gap-3">
                    <div className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-full">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">
                          {TYPE_LABEL[it.type]}
                        </span>
                        {it.outcome && (
                          <Badge variant="secondary">
                            {OUTCOME_LABEL[it.outcome]}
                          </Badge>
                        )}
                        <span className="text-muted-foreground ml-auto text-xs">
                          {format(parseISO(it.occurredAt), "MMM d, yyyy")}
                        </span>
                      </div>
                      {it.notes && (
                        <p className="mt-0.5 whitespace-pre-wrap text-sm">
                          {it.notes}
                        </p>
                      )}
                      {it.byName && (
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          by {it.byName}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {member.memberStatus === "active" && (
        <div className="text-center">
          <button
            onClick={removeFromFollowUp}
            className="text-muted-foreground hover:text-foreground text-sm hover:underline"
          >
            Remove from follow-up
          </button>
        </div>
      )}

      {/* Log interaction dialog */}
      <Dialog open={logOpen} onOpenChange={(o) => !savingLog && setLogOpen(o)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Log an interaction</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select
                  value={logType}
                  onValueChange={(v) => setLogType(v as InteractionType)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOG_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="log-date">Date</Label>
                <input
                  id="log-date"
                  type="date"
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                  className="border-input flex h-11 w-full rounded-lg border bg-transparent px-3.5 text-sm outline-none"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Outcome</Label>
              <Select value={logOutcome} onValueChange={setLogOutcome}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OUTCOME_NONE}>—</SelectItem>
                  {(
                    Object.keys(OUTCOME_LABEL) as InteractionOutcome[]
                  ).map((o) => (
                    <SelectItem key={o} value={o}>
                      {OUTCOME_LABEL[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="log-notes">Notes</Label>
              <Textarea
                id="log-notes"
                value={logNotes}
                onChange={(e) => setLogNotes(e.target.value)}
                placeholder="What happened?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLogOpen(false)}
              disabled={savingLog}
            >
              Cancel
            </Button>
            <Button onClick={saveLog} disabled={savingLog}>
              {savingLog && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send SMS dialog */}
      <Dialog open={smsOpen} onOpenChange={(o) => !sendingSms && setSmsOpen(o)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Send SMS</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">
              To {member.name} · {member.phone}
            </p>
            <Textarea
              value={smsMsg}
              onChange={(e) => setSmsMsg(e.target.value)}
              placeholder="Type your message…"
              rows={4}
              maxLength={800}
            />
            <p className="text-muted-foreground text-right text-xs">
              {smsMsg.length}/800
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSmsOpen(false)}
              disabled={sendingSms}
            >
              Cancel
            </Button>
            <Button onClick={sendSms} disabled={sendingSms || !smsMsg.trim()}>
              {sendingSms && <Loader2 className="animate-spin" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
