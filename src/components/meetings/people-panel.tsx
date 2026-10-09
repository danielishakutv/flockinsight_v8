"use client";

import {
  Hand,
  Mic,
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
import { initialsOf, isOnPlatform, type RosterEntry } from "@/lib/meetings-shared";
import type { PeerDiagnostics } from "@/lib/meeting-client";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

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
  attendeeMediaLocked,
}: {
  roster: RosterEntry[];
  /**
   * Whether this room has taken the microphone or the camera away from
   * ordinary attendees.
   *
   * It changes what the host's menu needs to offer: in a locked room, "let
   * them speak" is the action somebody is looking for when a hand goes up,
   * and without it the only way to answer a raised hand is to make the person
   * a co-host — which hands them the power to end the meeting.
   */
  attendeeMediaLocked: boolean;
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
  onPromote: (
    participantId: string,
    role: "cohost" | "speaker" | "attendee",
  ) => void;
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
                attendeeMediaLocked={attendeeMediaLocked}
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
              attendeeMediaLocked={attendeeMediaLocked}
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
      {/*
        Bytes arriving and frames decoding are different facts. Healthy bytes
        with zero frames is a decoder problem; frames with a black tile is a
        rendering problem. Without this line the two are indistinguishable,
        which is how a week goes.
      */}
      {link.videoInKbps > 0 && (
        <span className={cn("block", link.framesDecoded === 0 && "text-rose-400")}>
          {`${link.framesDecoded} frames decoded`}
          {link.framesDropped > 0 ? ` · ${link.framesDropped} dropped` : ""}
        </span>
      )}
      {/*
        The voice, which is what people actually complain about and what this
        panel could not previously say a word about.

        Three numbers because they separate three causes that sound identical
        from a seat in the meeting. `invented` is the share of audio the
        browser had to make up because nothing arrived in time to play — that
        IS "the sound keeps cutting", measured. Loss with low invented means
        the redundancy is doing its job and nothing needs fixing. Low loss
        with high invented is jitter, and the held figure is what to look at:
        if it is already at the target and still breaking up, the target is
        too low. Both low with nobody audible is a microphone at the other
        end, and no amount of bandwidth will touch it.

        Shown whenever a voice is arriving, not only when it is going wrong:
        knowing what a healthy line reads is what makes an unhealthy one
        recognisable.
      */}
      {link.audioInKbps > 0 && (
        <span
          className={cn(
            "block",
            link.audioConcealedPct >= 5 && "text-amber-400",
            link.audioConcealedPct >= 15 && "text-rose-400",
          )}
        >
          {`${t("meetings.diagVoice")} ${link.audioLossPct}% lost · ${link.audioConcealedPct}% ${t("meetings.diagInvented")}`}
          {` · ${link.audioJitterMs}ms jitter · ${link.audioJitterBufferMs}ms ${t("meetings.diagHeld")}`}
          {link.audioRedundancy ? ` · ${t("meetings.diagProtected")}` : ""}
        </span>
      )}
      {/*
        The last link in the chain, and the one `getStats` cannot see. Frames
        can decode perfectly into an element that is paused, or that was never
        given the stream at all — which is precisely what happened here.
      */}
      {link.element && (
        <span
          className={cn(
            "block",
            (link.element.width === 0 || link.element.paused) && "text-rose-400",
          )}
        >
          {`element ${link.element.width}px`}
          {link.element.paused ? " · paused" : " · playing"}
          {` · ready ${link.element.readyState}`}
        </span>
      )}
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
  attendeeMediaLocked,
}: {
  person: RosterEntry;
  isSelf: boolean;
  canHost: boolean;
  onMute: (id: string) => void;
  onRemove: (id: string) => void;
  onPromote: (id: string, role: "cohost" | "speaker" | "attendee") => void;
  link?: PeerDiagnostics;
  attendeeMediaLocked: boolean;
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
        {/*
          Why this person's microphone icon is off, when it is not their
          choice. Without it a host looking at forty crossed-out microphones
          cannot tell who muted themselves from who was never able to unmute.
        */}
        {attendeeMediaLocked && !isOnPlatform(person.role) && (
          <span className="block text-[11px] text-amber-500/80">
            {t("meetings.onlyTheHostSpeaks")}
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
            {/*
              The answer to a raised hand in a room where only the platform
              may speak. A speaker can be heard and seen and can do nothing
              else — it is not a co-host, and that distinction is the whole
              reason the role exists.
            */}
            {attendeeMediaLocked && person.role === "attendee" && (
              <DropdownMenuItem onClick={() => onPromote(person.id, "speaker")}>
                <Mic className="size-4" /> {t("meetings.letThemSpeak")}
              </DropdownMenuItem>
            )}
            {attendeeMediaLocked && person.role === "speaker" && (
              <DropdownMenuItem onClick={() => onPromote(person.id, "attendee")}>
                <MicOff className="size-4" /> {t("meetings.stopThemSpeaking")}
              </DropdownMenuItem>
            )}
            {person.role === "attendee" || person.role === "speaker" ? (
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
