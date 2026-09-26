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
import type { PeerDiagnostics } from "@/lib/meeting-client";
import { useT } from "@/components/i18n-provider";

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
  diagnostics,
}: {
  roster: RosterEntry[];
  /**
   * What each peer connection is actually doing, keyed by peer id.
   *
   * Shown under every name. Video that does not arrive has half a dozen
   * possible causes across three layers and from the outside they all look
   * the same — a tile with a face on it and no picture. This says which layer
   * it stopped at, which is the difference between an afternoon of theories
   * and one screenshot.
   */
  diagnostics?: Map<string, PeerDiagnostics>;
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
  const t = useT();
  const hands = roster.filter((r) => r.handRaised);
  const rest = roster.filter((r) => !r.handRaised);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {canHost && waiting.length > 0 && (
        <div className="border-b border-white/10 bg-amber-500/10 p-3">
          <p className="mb-2 text-xs font-bold tracking-wide text-amber-300 uppercase">
            {t("meetings.waitingToBeLetIn")} ({waiting.length})
          </p>
          <ul className="space-y-2">
            {waiting.map((w) => (
              <li key={w.participantId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm text-white">{w.name}</span>
                <Button size="sm" onClick={() => onAdmit(w.participantId)}>
                  {t("meetings.letIn")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-slate-300 hover:text-white"
                  onClick={() => onDeny(w.participantId)}
                >
                  {t("common.no")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {hands.length > 0 && (
          <Section title={`${t("meetings.handsUp")} (${hands.length})`}>
            {hands.map((p) => (
              <Row
                key={p.peerId}
                person={p}
                isSelf={p.peerId === myPeerId}
                canHost={canHost}
                onMute={onMute}
                onRemove={onRemove}
                onPromote={onPromote}
                link={diagnostics?.get(p.peerId)}
              />
            ))}
          </Section>
        )}
        <Section title={`${t("meetings.inTheMeeting")} (${roster.length})`}>
          {rest.map((p) => (
            <Row
              key={p.peerId}
              person={p}
              isSelf={p.peerId === myPeerId}
              canHost={canHost}
              onMute={onMute}
              onRemove={onRemove}
              onPromote={onPromote}
              link={diagnostics?.get(p.peerId)}
            />
          ))}
        </Section>
      </div>

      {canHost && (
        <div className="flex gap-2 border-t border-white/10 p-3">
          <Button variant="secondary" size="sm" className="flex-1" onClick={onMuteAll}>
            <MicOff className="size-4" /> {t("meetings.muteEveryone")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={onLowerHands}
            disabled={hands.length === 0}
          >
            <Hand className="size-4" /> {t("meetings.lowerHands")}
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

/**
 * One line of truth about a peer connection.
 *
 * Deliberately plain numbers rather than a verdict. "Poor connection" is what
 * every other product says and it is useless — it does not distinguish a
 * camera that is off, a peer who is saving data, a track that was never
 * attached, an encoder producing nothing, and a network dropping it. Each of
 * those needs a different person to do a different thing.
 *
 * kbps rather than totals, because a total that stopped growing ten minutes
 * ago looks exactly like one that is growing now, and "is it moving RIGHT
 * NOW" is the only question worth asking of a call in progress.
 */
function LinkLine({ link, cameraOn }: { link: PeerDiagnostics; cameraOn: boolean }) {
  const t = useT();

  // The most useful case first: their camera is on and nothing is arriving.
  const stalled = cameraOn && link.videoInKbps === 0;

  const why =
    link.videoWithheld === "camera-off"
      ? t("meetings.diagCameraOff")
      : link.videoWithheld === "they-save-data"
        ? t("meetings.diagTheySaveData")
        : null;

  return (
    <span className="mt-0.5 block font-mono text-[10px] leading-tight text-slate-500">
      <span className={stalled ? "text-amber-400" : undefined}>
        {`↓ ${link.videoInKbps}k video · ${link.audioInKbps}k audio`}
      </span>
      {"  "}
      <span>{`↑ ${link.videoOutKbps}k video · ${link.audioOutKbps}k audio`}</span>
      <span className="block">
        {link.ice}
        {link.transport ? ` · ${link.transport}` : ""}
        {link.videoAttached ? "" : " · no video track sent"}
        {why ? ` · ${why}` : ""}
      </span>
    </span>
  );
}

function Row({
  person,
  isSelf,
  canHost,
  onMute,
  onRemove,
  onPromote,
  link,
}: {
  person: RosterEntry;
  isSelf: boolean;
  canHost: boolean;
  onMute: (id: string) => void;
  onRemove: (id: string) => void;
  onPromote: (id: string, role: "cohost" | "attendee") => void;
  link?: PeerDiagnostics;
}) {
  const t = useT();
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
            <ShieldCheck
              className="size-3.5 shrink-0 text-indigo-400"
              aria-label={t("meetings.host")}
            />
          )}
        </span>
        {person.lowData && (
          <span className="block text-[11px] text-slate-500">
            {t("meetings.audioOnlyCameraStays")}
          </span>
        )}
        {link && <LinkLine link={link} cameraOn={person.cameraOn} />}
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
              aria-label={person.name}
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onMute(person.id)} disabled={!person.micOn}>
              <MicOff className="size-4" /> {t("meetings.mute")}
            </DropdownMenuItem>
            {person.role === "attendee" ? (
              <DropdownMenuItem onClick={() => onPromote(person.id, "cohost")}>
                <UserPlus className="size-4" /> {t("meetings.makeCohost")}
              </DropdownMenuItem>
            ) : person.role === "cohost" ? (
              <DropdownMenuItem onClick={() => onPromote(person.id, "attendee")}>
                <UserMinus className="size-4" /> {t("meetings.removeCohost")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onRemove(person.id)}>
              <UserMinus className="size-4" /> {t("meetings.removeFromMeeting")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
