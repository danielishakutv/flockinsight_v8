"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Copy, KeyRound, Loader2, PhoneOff, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  cancelMeeting,
  duplicateMeeting,
  endMeetingNow,
  recordAttendanceFromMeeting,
  reopenMeeting,
  rotatePasscode,
} from "@/app/(app)/meetings/actions";

/**
 * The host's controls from outside the room — the things that still need doing
 * once the meeting is over, or when the person who started it has gone offline
 * with the room still marked live.
 */
export function MeetingActions({
  id,
  status,
  access,
  hasParticipants,
  canRecordAttendance,
}: {
  id: string;
  status: string;
  access: string;
  hasParticipants: boolean;
  canRecordAttendance: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "That didn't work.");
        return;
      }
      toast.success(done);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Manage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {canRecordAttendance && hasParticipants && (
          <Button
            variant="secondary"
            className="w-full justify-start"
            disabled={pending}
            onClick={() =>
              run(
                () => recordAttendanceFromMeeting(id),
                "Attendance recorded from this meeting.",
              )
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <ClipboardCheck />}
            Record attendance from this meeting
          </Button>
        )}

        <Button
          variant="secondary"
          className="w-full justify-start"
          disabled={pending}
          onClick={() => run(() => duplicateMeeting(id), "A new meeting is ready.")}
        >
          <Copy /> Run this meeting again
        </Button>

        {access === "passcode" && (
          <Button
            variant="secondary"
            className="w-full justify-start"
            disabled={pending}
            onClick={() =>
              run(() => rotatePasscode(id), "New passcode issued — the old one is dead.")
            }
          >
            <KeyRound /> Issue a new passcode
          </Button>
        )}

        {status === "live" && (
          <Button
            variant="secondary"
            className="w-full justify-start"
            disabled={pending}
            onClick={() => run(() => endMeetingNow(id), "Meeting ended.")}
          >
            <PhoneOff /> End it now
          </Button>
        )}

        {status === "scheduled" && (
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive w-full justify-start"
            disabled={pending}
            onClick={() => run(() => cancelMeeting(id), "Meeting cancelled.")}
          >
            <XCircle /> Cancel this meeting
          </Button>
        )}

        {status === "cancelled" && (
          <Button
            variant="secondary"
            className="w-full justify-start"
            disabled={pending}
            onClick={() => run(() => reopenMeeting(id), "Back on the calendar.")}
          >
            Put it back on
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
