"use client";

import {
  Hand,
  MicOff,
  MoreVertical,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Video,
  VideoOff,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { initialsOf, type RosterEntry } from "@/lib/meetings-shared";

/**
 * Who is here, plus the host's controls over them.
 *
 * Hands go to the top. In a church meeting the raised hand is nearly always
 * the reason someone opened this panel, and making a host hunt for it in a
 * list of forty is how a person gets forgotten.
 */
export function PeoplePanel({
  roster,
  waiting,
  myPeerId,
  canHost,
  onMute,
  onRemove,
  onPromote,
  onAdmit,
  onDeny,
  onMuteAll,
  onLowerHands,
}: {
  roster: RosterEntry[];
  waiting: { participantId: string; name: string }[];
  myPeerId: string;
  canHost: boolean;
  onMute: (participantId: string) => void;
  onRemove: (participantId: string) => void;
  onPromote: (participantId: string, role: "cohost" | "attendee") => void;
  onAdmit: (participantId: string) => void;
  onDeny: (participantId: string) => void;
  onMuteAll: () => void;
  onLowerHands: () => void;
}) {
  const hands = roster.filter((r) => r.handRaised);
  const rest = roster.filter((r) => !r.handRaised);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {canHost && waiting.length > 0 && (
        <div className="border-b border-white/10 bg-amber-500/10 p-3">
          <p className="mb-2 text-xs font-bold tracking-wide text-amber-300 uppercase">
            Waiting to be let in ({waiting.length})
          </p>
          <ul className="space-y-2">
            {waiting.map((w) => (
              <li key={w.participantId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm text-white">{w.name}</span>
                <Button size="sm" onClick={() => onAdmit(w.participantId)}>
                  Let in
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-slate-300 hover:text-white"
                  onClick={() => onDeny(w.participantId)}
                >
                  No
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {hands.length > 0 && (
          <Section title={`Hands up (${hands.length})`}>
            {hands.map((p) => (
              <Row
                key={p.peerId}
                person={p}
                isSelf={p.peerId === myPeerId}
                canHost={canHost}
                onMute={onMute}
                onRemove={onRemove}
                onPromote={onPromote}
              />
            ))}
          </Section>
        )}
        <Section title={`In the meeting (${roster.length})`}>
          {rest.map((p) => (
            <Row
              key={p.peerId}
              person={p}
              isSelf={p.peerId === myPeerId}
              canHost={canHost}
              onMute={onMute}
              onRemove={onRemove}
              onPromote={onPromote}
            />
          ))}
        </Section>
      </div>

      {canHost && (
        <div className="flex gap-2 border-t border-white/10 p-3">
          <Button variant="secondary" size="sm" className="flex-1" onClick={onMuteAll}>
            <MicOff className="size-4" /> Mute everyone
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={onLowerHands}
            disabled={hands.length === 0}
          >
            <Hand className="size-4" /> Lower hands
          </Button>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-3">
      <p className="mb-2 text-xs font-bold tracking-wide text-slate-400 uppercase">
        {title}
      </p>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function Row({
  person,
  isSelf,
  canHost,
  onMute,
  onRemove,
  onPromote,
}: {
  person: RosterEntry;
  isSelf: boolean;
  canHost: boolean;
  onMute: (id: string) => void;
  onRemove: (id: string) => void;
  onPromote: (id: string, role: "cohost" | "attendee") => void;
}) {
  const isHost = person.role === "host" || person.role === "cohost";

  return (
    <li className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-white/5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white">
        {initialsOf(person.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-white">
            {person.name}
            {isSelf && " (you)"}
          </span>
          {isHost && (
            <ShieldCheck className="size-3.5 shrink-0 text-indigo-400" aria-label="Host" />
          )}
        </span>
        {person.lowData && (
          <span className="text-[11px] text-slate-500">Audio only</span>
        )}
      </span>

      <span className="flex shrink-0 items-center gap-1.5 text-slate-400">
        {person.handRaised && <Hand className="size-4 text-amber-400" />}
        {person.micOn ? null : <MicOff className="size-4" />}
        {person.cameraOn ? (
          <Video className="size-4" />
        ) : (
          <VideoOff className="size-4 opacity-50" />
        )}
      </span>

      {canHost && !isSelf && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-slate-400 hover:text-white"
              aria-label={`Options for ${person.name}`}
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onMute(person.id)} disabled={!person.micOn}>
              <MicOff className="size-4" /> Mute
            </DropdownMenuItem>
            {person.role === "attendee" ? (
              <DropdownMenuItem onClick={() => onPromote(person.id, "cohost")}>
                <UserPlus className="size-4" /> Make co-host
              </DropdownMenuItem>
            ) : person.role === "cohost" ? (
              <DropdownMenuItem onClick={() => onPromote(person.id, "attendee")}>
                <UserMinus className="size-4" /> Remove co-host
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onRemove(person.id)}>
              <UserMinus className="size-4" /> Remove from meeting
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
