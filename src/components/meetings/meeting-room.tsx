"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Circle,
  Download,
  Hand,
  Loader2,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MoreHorizontal,
  PhoneOff,
  Presentation,
  RefreshCcw,
  Signal,
  SignalLow,
  SignalMedium,
  SwitchCamera,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatBytes } from "@/lib/storage-bytes";
import { watchStalls, worstStall } from "@/lib/meeting-stalls";
import { RecordingUploader } from "@/components/meetings/recording-uploader";
import {
  meetingSoundsDefault,
  meetingSoundsEnabled,
  playArrivalChime,
  playDepartureChime,
  releaseMeetingSounds,
  setMeetingSoundsEnabled,
  subscribeMeetingSounds,
} from "@/lib/meeting-sounds";
import {
  downloadEntry,
  listPending,
  type VaultEntry,
} from "@/lib/recording-vault";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  canShareScreen,
  deviceId,
  EMPTY_STAGE,
  formatDuration,
  isHostRole,
  parseStage,
  REACTIONS,
  tileColumns,
  type MeetingQuality,
  type RosterEntry,
  type Stage,
} from "@/lib/meetings-shared";
import {
  MeetingClient,
  type LocalState,
  type MediaFault,
  type PeerDiagnostics,
  type RemoteMedia,
} from "@/lib/meeting-client";
import {
  JoinScreen,
  type JoinValues,
  mediaFaultKey,
} from "@/components/meetings/join-screen";
import { VideoTile } from "@/components/meetings/video-tile";
import { StageView } from "@/components/meetings/stage-view";
import { ChatPanel, type ChatMessage } from "@/components/meetings/chat-panel";
import { PeoplePanel } from "@/components/meetings/people-panel";
import { SharePanel } from "@/components/meetings/share-panel";
import { useSpeaking } from "@/components/meetings/use-speaking";
import { ShortcutsSheet } from "@/components/meetings/shortcuts-sheet";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";
import { BetaBadge } from "@/components/beta-badge";
import type { TFunction } from "@/lib/i18n/translate";
import { playWhenAllowed } from "@/lib/media-errors";

type Phase = "join" | "lobby" | "live" | "ended";
type Panel = "chat" | "people" | "share" | null;

type JoinResponse = {
  ok: boolean;
  error?: string;
  code?: string;
  meeting?: {
    id: string;
    code: string;
    title: string;
    allowChat: boolean;
    allowReactions: boolean;
    allowScreenShare: boolean;
    transport?: string;
    allowRecording: boolean;
    allowAttendeeMic?: boolean;
    allowAttendeeCamera?: boolean;
    churchName: string;
    churchLogo: string | null;
  };
  me?: {
    participantId: string;
    peerId: string;
    secret: string;
    role: string;
    admitted: boolean;
    name: string;
    micOn: boolean;
    cameraOn: boolean;
    lowData: boolean;
  };
  ice?: { iceServers: RTCIceServer[]; iceTransportPolicy: "all" | "relay"; hasTurn: boolean };
  roster?: RosterEntry[];
  stage?: Stage;
  messages?: ChatMessage[];
  cursor?: number;
};

/** What a recording captures: the composited room, or the voices alone. */
type RecordingMode = "video" | "audio";

/**
 * How many people's cameras to actually receive at once.
 *
 * Not how many tiles are drawn — how many streams are paid for. Nine covers a
 * full grid on a laptop and every phone layout, and anybody past it is a tile
 * with initials in it until they speak or are spotlit.
 */
const VISIBLE_VIDEO = 9;

/** A store that never emits. For reading a fact the browser will not change. */
const NEVER_CHANGES = () => () => {};

export function MeetingRoom(props: {
  code: string;
  title: string;
  churchName: string;
  churchLogo: string | null;
  needsPasscode: boolean;
  membersOnly: boolean;
  signedIn: boolean;
  defaultName: string;
  lowDataDefault: boolean;
  /**
   * Whether this visitor will be allowed a microphone and a camera.
   *
   * Worked out on the server, where the host link, the signed-in session and
   * the church's staff list are all known — the pre-join screen cannot decide
   * it and must not guess, because showing somebody a camera preview and then
   * taking the control away the second they walk in is worse than telling them
   * at the door.
   */
  mediaLocked: { mic: boolean; camera: boolean };
  /** From ?h= — proves to the server that this is the host, link in hand. */
  hostKey?: string | null;
  signInHref: string;
  manageHref: string | null;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("join");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [endedReason, setEndedReason] = useState("");
  /**
   * Whether coming back is even possible.
   *
   * Only someone who left of their own accord can rejoin. A meeting that was
   * ended, or that this person was removed from, is closed — and a Rejoin button
   * over a closed room is a button that cannot work, which is worse than no
   * button at all.
   */
  const [rejoinable, setRejoinable] = useState(false);

  const [session, setSession] = useState<JoinResponse | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [media, setMedia] = useState<Map<string, RemoteMedia>>(new Map());
  const [stage, setStage] = useState<Stage>(EMPTY_STAGE);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [local, setLocal] = useState<LocalState | null>(null);
  const [transport, setTransport] = useState<"online" | "retrying" | "offline">("online");
  const [panel, setPanel] = useState<Panel>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /*
   * Whether this device plays a note when somebody arrives or leaves.
   *
   * The same arrangement as `shareCapable` above and for the same reason: the
   * answer lives in `localStorage`, which the server cannot read, so it comes
   * through a store with a server snapshot of "on" rather than through state
   * seeded from an effect.
   */
  const sounds = useSyncExternalStore(
    subscribeMeetingSounds,
    meetingSoundsEnabled,
    meetingSoundsDefault,
  );

  const toggleSounds = useCallback(() => {
    const next = !meetingSoundsEnabled();
    setMeetingSoundsEnabled(next);
    // Play the arrival note when switching them on, so the choice is confirmed
    // by the thing it chose rather than by a line of text.
    if (next) playArrivalChime();
  }, []);
  /*
   * A mirror of `panel` for the back-gesture listener below. That listener
   * pushes a history entry when it registers, so re-registering it on every
   * panel change would stack up an entry per tap — the ref lets it read the
   * current panel while staying registered once.
   */
  const panelRef = useRef<Panel>(null);
  const [unread, setUnread] = useState(0);
  const [handRaised, setHandRaised] = useState(false);
  /**
   * Peers whose voice the browser is holding until this person taps.
   *
   * Kept per peer because a phone can refuse each audio element separately,
   * and the banner has to stay up until every one of them is playing.
   */
  const [soundHeld, setSoundHeld] = useState<ReadonlySet<string>>(() => new Set());
  const reportSoundHeld = useCallback((peerId: string, held: boolean) => {
    setSoundHeld((prev) => {
      if (prev.has(peerId) === held) return prev;
      const next = new Set(prev);
      if (held) next.add(peerId);
      else next.delete(peerId);
      return next;
    });
  }, []);
  /** What I chose to look at. Mine alone, and only while nothing is spotlit. */
  const [pinned, setPinned] = useState<string | null>(null);
  /**
   * The way out: asked before the back gesture, and before the red button.
   *
   * For a host it is a choice rather than a confirmation — leave, or end it for
   * the room — because those are two different things and the button used to do
   * only the first while the second hid in a menu behind a browser `confirm()`.
   */
  const [confirmLeave, setConfirmLeave] = useState(false);
  /** While the end-for-everyone request is in flight. */
  const [endingForAll, setEndingForAll] = useState(false);
  /**
   * Whether this browser can share a screen at all. False on every iPhone and
   * iPad, where `getDisplayMedia` does not exist — so the control is not
   * offered rather than offered and dead.
   *
   * `useSyncExternalStore` rather than state set from an effect: it is a fact
   * about the browser that never changes, and the server snapshot says yes so
   * the button does not flash in and out during hydration. The second half is
   * the runtime override, for a browser that has the method and still refuses.
   */
  const shareCapable = useSyncExternalStore(
    NEVER_CHANGES,
    canShareScreen,
    () => true,
  );
  const [shareRefused, setShareRefused] = useState(false);
  const screenShareable = shareCapable && !shareRefused;
  /** What the host has put on the main screen for the whole room. */
  const [spotlight, setSpotlight] = useState<string | null>(null);
  /**
   * The server's clock at the moment the shared screen last changed, as this
   * browser understands it.
   *
   * There are three ways a change arrives — a broadcast signal, the body of a
   * poll, and the reply to the host's own action — and they do not arrive in
   * the order they happened. This keeps the newest one.
   */
  const roomStateAt = useRef(0);

  /**
   * Apply a change to what the whole room is looking at — once, and only if it
   * is newer than what is already on screen.
   *
   * This exists because of a real complaint: everybody else saw a verse appear
   * the instant it was shared, and the person who shared it waited up to five
   * seconds. The cause is in the signalling, and it is not a slow network.
   *
   * A host puts a verse up through /action. The server writes it and
   * broadcasts a `stage` signal, which wakes everyone's long-poll — and
   * `readSignals` filters out signals from the peer asking, which is correct
   * for an offer or an ICE candidate and exactly wrong here. So the host's own
   * poll is woken, finds nothing addressed to it, and goes back to waiting:
   * three seconds at a time, up to the twelve-second hold, until it gives up
   * and returns the fresh stage in the response body. The host watched their
   * own sermon slide arrive on a timer.
   *
   * The reply to the action already contained the new stage. It was thrown
   * away. Now it is applied, which is the same thing the chat has always done
   * — see `sendChat` — and it makes the person who shared it the FIRST to see
   * it rather than the last.
   *
   * The timestamp is the other half. Applying the reply early means a poll
   * that was already in flight can land a moment later carrying the previous
   * screen, and take the verse back down for three seconds. So every path
   * states when the server believed it, and an older answer is ignored. The
   * stage's own `rev` could order two stage changes, but not a stage against a
   * spotlight, and both ride in the same response.
   */
  const applyRoomState = useCallback(
    (
      at: string | undefined,
      next: { stage?: unknown; spotlightPeerId?: string | null },
    ) => {
      const when = at ? Date.parse(at) : Date.now();
      if (!Number.isFinite(when) || when < roomStateAt.current) return;
      roomStateAt.current = when;
      if (next.stage !== undefined) setStage(parseStage(next.stage));
      if (next.spotlightPeerId !== undefined) setSpotlight(next.spotlightPeerId);
    },
    [],
  );
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busyStage, setBusyStage] = useState(false);
  const [floaters, setFloaters] = useState<
    { id: string; emoji: string; left: number; name: string }[]
  >([]);
  /**
   * The recording in progress, if any.
   *
   * Always made by the recording service on the server, which captures the
   * room from the media server: this browser presses a button and does nothing
   * else, so a phone that sleeps or a tab that closes cannot lose it. The
   * server reports it on every poll, so every participant sees the pill and a
   * host who reloads can still press Stop.
   */
  const [recording, setRecording] = useState<{
    id: string | null;
    mode: RecordingMode;
    startedAt: number | null;
  } | null>(null);
  const recordingRef = useRef<typeof recording>(null);
  /** The call ended while a recording was running: say it is being saved. */
  const [savingOnServer, setSavingOnServer] = useState(false);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  /**
   * Recordings made in this browser by the old in-browser recorder that never
   * finished uploading. Nothing records here any more, but a file already on
   * the device is somebody's service, so it is still offered back until the
   * background uploader has drained it.
   */
  const [unsaved, setUnsaved] = useState<VaultEntry[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  /**
   * What each peer connection is doing, refreshed while the people panel is
   * open and not otherwise — the readings come free from the quality sampler
   * that already runs, and nobody needs them when nobody is looking.
   */
  const [diagnostics, setDiagnostics] = useState<Map<string, PeerDiagnostics>>(
    new Map(),
  );

  const clientRef = useRef<MeetingClient | null>(null);
  /**
   * So the call is wound up exactly once.
   *
   * There are four ways out — the Leave button, the host's End for everyone, a
   * removal, and the news arriving on a poll — and two of them can land within
   * a moment of each other.
   */
  const closingRef = useRef(false);
  /** True between pressing Record and the server's answer. */
  const startingRecordingRef = useRef(false);
  /** The roster as of the last render, for callbacks that must not re-create on every poll. */
  const rosterRef = useRef(roster);

  const me = session?.me;
  const meeting = session?.meeting;
  const canHost = isHostRole(me?.role ?? "attendee");

  /*
   * Someone in the lobby finds out they are in the moment the roster names
   * them as admitted. Derived rather than pushed into state from an effect —
   * the roster IS the answer, and copying it into a second variable only
   * creates a window where the two disagree.
   *
   * Up here, above every effect that belongs to a live call, and those effects
   * read `view` rather than `phase`: `phase` stays "lobby" for the whole call
   * for anybody let in from the lobby, and gated on it they never got the
   * back-gesture trap (Android Back closed the tab and took them out), the
   * clock, rotation, the shortcuts or the join chimes.
   */
  const admittedNow =
    !!me && roster.some((r) => r.peerId === me.peerId && r.admitted);
  const view: Phase = phase === "lobby" && admittedNow ? "live" : phase;

  /**
   * Lobby entries this host has just answered, hidden until the roster says so.
   *
   * The server never echoes a host's own broadcast back to them, so after "Let
   * in" the entry would otherwise sit there until the next poll — up to the
   * whole long-poll hold — inviting a second tap. Participant ids are new on
   * every join, so this never needs clearing: somebody who knocks again is a
   * new row with a new id.
   */
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());

  /*
   * Who is waiting to be let in, read off the roster on every poll.
   *
   * It used to be built from `knock` signals, and a knock is sent once, when
   * the guest arrives — so a host who opened the room after the congregation
   * had started knocking, or who reloaded, started reading after those knocks
   * and saw an empty lobby while everybody waited at the door for ever. The
   * roster carries every waiting row, every time.
   */
  const waiting = useMemo(
    () =>
      canHost
        ? roster
            .filter((r) => !r.admitted && !answered.has(r.id))
            .map((r) => ({ participantId: r.id, name: r.name }))
        : [],
    [roster, canHost, answered],
  );

  /* ============================================================
   * Room events that arrive before anything else is set up
   * ========================================================== */

  /**
   * A device that would not open, said once and left on screen.
   *
   * Three things this does that a plain toast did not.
   *
   * It says it once. The camera and the microphone are refused by the same
   * permission dialog, so a blocked browser produced two stacked red boxes
   * saying the same thing about two different words.
   *
   * It stays. Everything here is something the person has to leave the page to
   * fix, and a message that fades after eight seconds is gone before they have
   * found the setting — leaving them in a room with no sound and no
   * explanation of why.
   *
   * And it offers the retry, because the obvious move after changing a
   * permission is to reload, and reloading drops them out of the meeting.
   */
  const reportMediaFault = useCallback(
    (fault: MediaFault, device: "microphone" | "camera") => {
      // Keyed on the fault, not the device: `blocked` for the camera and
      // `blocked` for the microphone are one problem with one fix.
      const id = `media-${fault}`;
      const both = fault === "blocked" || fault === "unsupported";

      toast.error(
        t(mediaFaultKey(fault), {
          device: both
            ? t("meetings.deviceCameraAndMic")
            : t(
                device === "camera"
                  ? "meetings.deviceCamera"
                  : "meetings.deviceMicrophone",
              ),
        }),
        {
          id,
          duration: Infinity,
          closeButton: true,
          action: {
            label: t("common.tryAgain"),
            onClick: () => {
              toast.dismiss(id);
              const c = clientRef.current;
              if (!c) return;
              if (device === "camera") void c.setCamera(true);
              else void c.setMic(true);
            },
          },
        },
      );
    },
    [t],
  );

  /**
   * A reaction someone tapped, drifting up the screen and gone.
   *
   * Carries the name because an emoji on its own is a reaction from nobody. In
   * a meeting of twenty, a lone thumbs-up tells the speaker that somebody
   * agreed and gives them no way to know who — which is most of the value of
   * having reacted at all.
   */
  function addFloater(emoji: string, name: string) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setFloaters((f) => [...f, { id, emoji, left: 10 + Math.random() * 70, name }]);
    setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 2600);
  }

  /**
   * Names the chat can offer after an "@".
   *
   * Everyone admitted, including the person typing: people do refer to
   * themselves in a thread, and leaving yourself out is a gap somebody has to
   * notice and work around.
   */
  const mentionables = useMemo(
    () =>
      roster
        .filter((r) => r.admitted)
        .map((r) => r.name)
        .filter((n, i, all) => n && all.indexOf(n) === i),
    [roster],
  );

  /** Who a peer id belongs to, falling back rather than showing a raw id. */
  const nameForPeer = useCallback(
    (peerId: string): string =>
      rosterRef.current.find((r) => r.peerId === peerId)?.name ??
      t("meetings.someone"),
    [t],
  );

  function react(emoji: string) {
    clientRef.current?.react(emoji);
    addFloater(emoji, t("meetings.you"));
  }

  /**
   * Room-wide host actions this screen has to follow.
   *
   * Not the lobby: who is waiting is read off the roster (see `waiting`), so
   * knock, admitted and denied need nothing here.
   *
   * "Lower all hands" clears every hand on the server, but my own hand button
   * is local state — left raised, the next tap sent "lowered", the hand never
   * went up and the host never saw it.
   */
  function handleControl(payload: Record<string, unknown>) {
    const action = String(payload.action ?? "");
    if (action === "lower-hands") setHandRaised(false);
  }

  /* ============================================================
   * Winding up
   *
   * Above joining, because joining wires the engine's `onEnded` straight to it.
   * ========================================================== */

  /**
   * Everything the room itself has to put down once the call is over.
   *
   * By the time this runs the engine has already closed the peer connections
   * and released the camera and microphone — that is its job, and it does it the
   * same way whichever of the four endings it was. A recording needs nothing
   * from this browser: the server stops it when the meeting ends.
   */
  const closeOut = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    clientRef.current = null;
  }, []);

  /* ============================================================
   * Joining
   * ========================================================== */

  const join = useCallback(
    async (values: JoinValues) => {
      setJoining(true);
      setJoinError(null);
      try {
        const res = await fetch(`/api/meet/${props.code}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...values,
            hostKey: props.hostKey ?? undefined,
            // So a reload, a crashed tab or a second click on the link is this
            // device coming back rather than another person in the room.
            deviceId: deviceId(),
          }),
        });
        const data: JoinResponse = await res.json();
        if (!data.ok || !data.me || !data.meeting || !data.ice) {
          setJoinError(data.error ?? t("common.somethingWentWrong"));
          setJoining(false);
          return;
        }

        setSession(data);
        setRoster(data.roster ?? []);
        setStage(parseStage(data.stage));
        setMessages(data.messages ?? []);
        setStartedAt(Date.now());

        if (!data.ice.hasTurn) {
          // Worth saying out loud: without a relay, some pairs of phones on
          // mobile data simply cannot reach each other, and the failure looks
          // random to the person it happens to.
          console.warn(
            "[meeting] No TURN server is configured. Connections may fail on mobile networks.",
          );
        }

        const client = new MeetingClient({
          code: props.code,
          peerId: data.me.peerId,
          secret: data.me.secret,
          cursor: data.cursor ?? 0,
          iceServers: data.ice.iceServers,
          iceTransportPolicy: data.ice.iceTransportPolicy,
          lowData: data.me.lowData,
          role: (data.me.role ?? "attendee") as RosterEntry["role"],
          /*
           * Defaulted open rather than closed. If this field ever fails to
           * arrive — an older server, a response shape that changed — the
           * failure must be "a room is less locked down than its host asked
           * for", not "nobody in the church can speak".
           */
          room: {
            allowAttendeeMic: data.meeting.allowAttendeeMic !== false,
            allowAttendeeCamera: data.meeting.allowAttendeeCamera !== false,
          },
          // Decided by the server before anybody joined. Everyone in a room
          // uses the same one; see the note on `meeting.transport`.
          transport: data.meeting.transport === "sfu" ? "sfu" : "mesh",
          // Who is already here, so their voices are asked for at once.
          roster: data.roster ?? [],
          events: {
            onRoster: setRoster,
            onRecordingState: (rec) => {
              setRecording(
                rec
                  ? {
                      id: rec.id,
                      mode: rec.mode === "audio" ? "audio" : "video",
                      startedAt: rec.startedAt ? Date.parse(rec.startedAt) : null,
                    }
                  : null,
              );
            },
            onStage: (next, at) => applyRoomState(at, { stage: next }),
            onMedia: setMedia,
            onLocalState: (s) => {
              setLocal(s);
              const streams = clientRef.current?.localStreams();
              setLocalStream(streams?.camera ?? null);
              setLocalScreen(streams?.screen ?? null);
            },
            onChat: (msg) => {
              setMessages((prev) =>
                prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
              );
              if (msg.kind === "chat") setUnread((u) => u + 1);
            },
            onReaction: (peer, emoji) => addFloater(emoji, nameForPeer(peer)),
            onSpotlight: (peerId, at) => applyRoomState(at, { spotlightPeerId: peerId }),
            onControl: (payload) => handleControl(payload),
            onRecording: (payload) => {
              if (payload.state === "started")
                toast.info(
                  t("meetings.recordingStarted", {
                    name: String(payload.by ?? t("meetings.host")),
                  }),
                );
              if (payload.state === "stopped")
                toast.info(t("meetings.recordingStopped"));
              // The recording service, reporting back to the room.
              if (payload.state === "saved")
                toast.success(t("meetings.savedToLibrary"));
              if (payload.state === "failed")
                toast.error(
                  t("meetings.recordingFailedOnServer", {
                    reason: String(payload.reason ?? ""),
                  }),
                  { duration: 15000 },
                );
            },
            onEnded: (reason) => {
              if (recordingRef.current) setSavingOnServer(true);
              /*
               * The engine reports in English because it has no dictionary.
               * Mapped here to the translated sentence, with the original kept
               * as the fallback so a reason we have not seen before still says
               * something true rather than nothing.
               */
              setEndedReason(endedMessage(reason, t));
              setRejoinable(
                reason.includes("left the meeting") || reason.includes("signed out"),
              );
              setPhase("ended");
              /*
               * And actually finish. This used to change the screen and nothing
               * else: the engine's connections stayed open and its camera stayed
               * on, so "the host ended the meeting" was a notice over a call
               * that was still running. The engine now releases its own devices
               * the moment it reaches this point.
               */
              closeOut();
            },
            onError: (message) => toast.error(message),
            onMediaFault: (fault, device) => reportMediaFault(fault, device),
            /*
             * A microphone that died and came back is worth one line, because
             * the person was talking into nothing for a second or two and is
             * owed the explanation. One that could not be recovered is worth
             * saying loudly: until now this was the silent failure behind
             * "my audio cut out and never came back".
             */
            onMicInterrupted: (outcome) => {
              if (outcome === "recovered") {
                toast.info(t("meetings.micRecovered"));
                return;
              }
              /*
               * "unheard" is the one that was silent until now: the microphone
               * is open and hearing the person perfectly, and none of it is
               * reaching the meeting. It stays on screen until dismissed,
               * because somebody who cannot be heard has no other way to find
               * out and the alternative is a whole service spent talking to
               * nobody.
               */
              if (outcome === "unheard") {
                toast.error(t("meetings.micUnheard"), { duration: Infinity });
                return;
              }
              toast.error(t("meetings.micLost"), { duration: 12000 });
            },
            /*
             * A connection that had to be thrown away and dialled again.
             *
             * Only the failures are said out loud. A connection rebuilt to
             * carry a better-protected voice is the engine doing its job on a
             * bad network, and announcing it would train people to ignore the
             * sentence that matters.
             *
             * That sentence is for one pair of people unable to hear each
             * other with every tile lit and nothing anywhere to suggest
             * anything had gone wrong — which is what this was before. Named
             * where we know the name: "ask them whether they can hear you" is
             * only actionable if you know who they are.
             */
            onPeerRebuilt: (peerId, reason) => {
              if (reason !== "stuck") return;
              const name = clientRef.current
                ?.roster()
                .find((r) => r.peerId === peerId)?.name;
              toast.warning(
                name
                  ? t("meetings.connectionRebuilt", { name })
                  : t("meetings.connectionRebuiltAnon"),
                { duration: 10000 },
              );
            },
            onShareUnsupported: () => {
              setShareRefused(true);
              toast.error(t("meetings.screenShareUnsupported"), { duration: 9000 });
            },
            onTransport: setTransport,
          },
        });

        clientRef.current = client;
        client.start();
        setLocal(client.currentState());

        if (data.me.micOn) await client.setMic(true);
        /*
         * Never a camera in Data Saver mode. The server already refuses the
         * combination, so this is belt and braces — but it is one line, and the
         * engine's answer to "camera on while saving data" is an error message,
         * which is not something to greet somebody with as they walk in.
         */
        if (data.me.cameraOn && !data.me.lowData) await client.setCamera(true);
        setLocalStream(client.localStreams().camera);

        setPhase(data.me.admitted ? "live" : "lobby");
      } catch {
        setJoinError(t("common.offline"));
      } finally {
        setJoining(false);
      }
    },
    [props.code, props.hostKey, t, reportMediaFault, nameForPeer, closeOut, applyRoomState],
  );

  /* ============================================================
   * Lobby → live, and host notifications
   * ========================================================== */

  /**
   * A note when somebody arrives, and a note when somebody leaves.
   *
   * Driven off the ROSTER, which is the server's own answer to who is in the
   * room and arrives on every poll — not off peer connections, which come and
   * go for reasons that have nothing to do with anybody walking in. A
   * connection that is rebuilt after a failed negotiation must not ring the
   * bell; the person never left.
   *
   * Three things this has to get right, each of which is somebody's bad
   * experience if it does not:
   *
   *   The first roster is seeded, never sounded. Walking into a room of eight
   *   people must not play eight chimes.
   *
   *   Yourself is never announced. You know.
   *
   *   A burst is one note. Six people arriving together — the end of a service,
   *   a WhatsApp link going round — is one arrival as far as the ear is
   *   concerned, and six overlapping chimes is just a noise.
   */
  const seenPeers = useRef<Set<string> | null>(null);
  const myPeerId = session?.me?.peerId ?? null;

  useEffect(() => {
    if (view !== "live") {
      // Re-seeded on the way back in, so a rejoin does not announce the room.
      seenPeers.current = null;
      return;
    }

    const now = new Set(
      roster.filter((r) => r.admitted && r.peerId !== myPeerId).map((r) => r.peerId),
    );
    const before = seenPeers.current;
    seenPeers.current = now;
    if (before === null) return;

    let arrived = false;
    let left = false;
    for (const peerId of now) if (!before.has(peerId)) arrived = true;
    for (const peerId of before) if (!now.has(peerId)) left = true;

    if (!sounds) return;
    // Both at once — somebody swapping phones mid-call — is an arrival. The
    // room gained somebody, which is the more useful of the two to hear.
    if (arrived) playArrivalChime();
    else if (left) playDepartureChime();
  }, [roster, view, myPeerId, sounds]);

  // The context holds an audio device open, which on a phone is the difference
  // between a call ending and the earpiece staying taken.
  useEffect(() => releaseMeetingSounds, []);

  /*
   * Write down any minute this device spends not responding.
   *
   * Three devices in one meeting froze with a black screen, dropped out, and
   * came back — and there was nothing to look at afterwards, because the only
   * witness was a tab that had stopped running and whoever it happened to had
   * already reloaded. This survives that reload. It costs one timer.
   */
  useEffect(() => {
    if (view !== "live") return;
    return watchStalls(() => ({
      connections: null,
      elements: document.querySelectorAll("video, audio").length,
    }));
  }, [view]);

  /* ============================================================
   * Timers
   * ========================================================== */

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    if (view !== "live") return;
    const t = setInterval(() => {
      if (startedAt) setElapsed(Math.round((Date.now() - startedAt) / 1000));
      const rec = recordingRef.current;
      if (rec?.startedAt) {
        setRecordingElapsed(Math.max(0, Math.round((Date.now() - rec.startedAt) / 1000)));
      }
    }, 1000);
    return () => clearInterval(t);
  }, [view, startedAt]);

  /* ============================================================
   * Leaving
   * ========================================================== */

  /**
   * Leave — just me. The meeting carries on for everybody else.
   *
   * Goes through the engine's own ending rather than tearing down from here, so
   * leaving, being removed and the host ending it all travel the same road and
   * cannot drift apart.
   */
  const leave = useCallback(() => {
    const client = clientRef.current;
    if (!client) {
      setEndedReason(t("meetings.youLeft"));
      setRejoinable(true);
      setPhase("ended");
      closeOut();
      return;
    }
    client.leave();
    client.endLocally("You left the meeting.");
  }, [closeOut, t]);

  useEffect(() => {
    const onUnload = () => clientRef.current?.leave(true);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      clientRef.current?.leave(true);
      void clientRef.current?.stop();
      clientRef.current = null;
    };
  }, []);

  /**
   * The back gesture should close a panel, not the meeting.
   *
   * Somebody opens the meeting link from WhatsApp, so the room is the first
   * page in that tab's history. On Android, back on the first page closes the
   * tab; on iOS it goes back to WhatsApp and Safari suspends the page. Either
   * way the person is out of the call, mid-sentence, having pressed the button
   * they press for "close this thing I just opened".
   *
   * An extra history entry is pushed when the room opens, so there is always
   * something to go back TO. Back then pops that entry, which is caught here
   * and turned into the thing they almost certainly meant: close the panel if
   * one is open, otherwise ask whether to leave. The entry is pushed again
   * either way, so the trap survives being sprung.
   *
   * No `beforeunload` prompt: browsers only honour it after an interaction,
   * it cannot be worded, and on a phone it usually does not appear at all.
   */
  useEffect(() => {
    if (view !== "live") return;

    window.history.pushState({ meeting: true }, "");

    const onPop = () => {
      // Re-arm first, so a second press is caught too.
      window.history.pushState({ meeting: true }, "");

      if (panelRef.current) {
        setPanel(null);
        return;
      }
      setConfirmLeave(true);
    };

    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [view]);

  useEffect(() => {
    panelRef.current = panel;
  }, [panel]);

  /*
   * Re-take the camera when the phone is turned.
   *
   * The capture is asked for in the shape the device is held in, so a rotation
   * needs a fresh one or a person who turns their phone sideways stays in a
   * tall strip. `replaceTrack` under the hood, so nobody renegotiates and the
   * room just sees the picture change shape.
   */
  useEffect(() => {
    if (view !== "live") return;
    const onRotate = () => void clientRef.current?.handleRotation();
    const mql = window.matchMedia("(orientation: portrait)");
    mql.addEventListener("change", onRotate);
    return () => mql.removeEventListener("change", onRotate);
  }, [view]);

  useEffect(() => {
    if (panel !== "people") return;
    const read = () => {
      const rows = clientRef.current?.diagnostics() ?? [];
      setDiagnostics(new Map(rows.map((d) => [d.peerId, d])));
    };
    read();
    const t = setInterval(read, 2000);
    return () => clearInterval(t);
  }, [panel]);

  /* ============================================================
   * Derived view state (`view` itself is worked out near the top)
   * ========================================================== */

  const others = useMemo(
    () => roster.filter((r) => r.peerId !== me?.peerId && r.admitted),
    [roster, me?.peerId],
  );

  const sharer = useMemo(() => {
    for (const [peerId, m] of media) {
      if (!m.hasScreen || !m.screenStream) continue;

      /*
       * They must SAY they are sharing, not merely appear to be.
       *
       * A screen share used to be inferred from "there is a live, unmuted
       * track in the screen slot". Every peer has a screen transceiver open
       * whether or not anybody is sharing, so an idle track sitting in that
       * slot only had to flicker unmuted once — which it does when tracks are
       * re-assigned — and the whole room was told somebody was sharing their
       * screen, over a black stage, for the rest of the meeting. Turning the
       * camera off did not clear it, because the track was still there.
       *
       * Sharing is a deliberate act and the person doing it already tells the
       * server, which puts it in the roster on every poll. That is the
       * authority; the track is only how the pixels get here.
       */
      if (!roster.find((r) => r.peerId === peerId)?.sharing) continue;

      return {
        peerId,
        stream: m.screenStream,
        name: roster.find((r) => r.peerId === peerId)?.name ?? "Someone",
      };
    }
    if (local?.sharing && localScreen) {
      return { peerId: me?.peerId ?? "me", stream: localScreen, name: "You" };
    }
    return null;
  }, [media, roster, local?.sharing, localScreen, me?.peerId]);

  const speakingSources = useMemo(
    () =>
      others.map((r) => ({ id: r.peerId, stream: media.get(r.peerId)?.stream ?? null })),
    [others, media],
  );
  const speaking = useSpeaking(speakingSources);

  /*
   * Whose pictures we actually want off the SFU.
   *
   * Voices come from everybody; pictures only from the people on screen. Every
   * camera in a two-hundred-person room is about sixty megabits a second down,
   * which no connection this product exists for has — and it is the media bill
   * as well. Nine of them is about four.
   *
   * The order is the room's own attention: whoever is spotlit or pinned, then
   * whoever is speaking, then everybody else. So the people who matter keep
   * their picture when the grid is larger than the budget.
   *
   * A string rather than a Set, because this drives an effect and a new Set
   * every render would re-send it several times a second.
   */
  const watchedKey = useMemo(() => {
    const focused = spotlight ?? pinned;
    return [
      ...others.filter((r) => r.peerId === focused),
      ...others.filter((r) => r.peerId !== focused && speaking.has(r.peerId)),
      ...others.filter((r) => r.peerId !== focused && !speaking.has(r.peerId)),
    ]
      .slice(0, VISIBLE_VIDEO)
      .map((r) => r.peerId)
      .join(",");
  }, [others, speaking, spotlight, pinned]);

  useEffect(() => {
    clientRef.current?.setVideoInterest(watchedKey ? watchedKey.split(",") : []);
  }, [watchedKey]);

  const showStage = !!sharer || stage.kind !== "none";

  // In an effect rather than during render: a ref written while rendering is
  // read back at a moment React makes no promises about.
  useEffect(() => {
    rosterRef.current = roster;
  }, [roster]);

  /* ============================================================
   * Controls
   * ========================================================== */

  /*
   * The engine refuses a locked microphone too, and says so — but in English,
   * because it has no dictionary. Checked here as well so the sentence arrives
   * in the reader's own language, which on this product is eight of them and
   * lands on exactly the person least able to work out what went wrong.
   */
  const toggleMic = useCallback(() => {
    const c = clientRef.current;
    if (!c) return;
    const state = c.currentState();
    if (!state.micOn && !state.rights.mic) {
      toast.info(t("meetings.micLockedHint"));
      return;
    }
    void c.setMic(!state.micOn);
  }, [t]);

  const toggleCamera = useCallback(() => {
    const c = clientRef.current;
    if (!c) return;
    const state = c.currentState();
    if (!state.cameraOn && !state.rights.camera) {
      toast.info(t("meetings.cameraLockedHint"));
      return;
    }
    void c.setCamera(!state.cameraOn).then(() =>
      setLocalStream(c.localStreams().camera),
    );
  }, [t]);

  const toggleScreenShare = useCallback(() => {
    const c = clientRef.current;
    if (!c) return;
    void c.setScreenShare(!c.currentState().sharing).then(() =>
      setLocalScreen(c.localStreams().screen),
    );
  }, []);

  const toggleLowData = useCallback(() => {
    const c = clientRef.current;
    if (!c) return;
    const next = !c.currentState().lowData;
    void c.setLowData(next);
    setLocalStream(c.localStreams().camera);
    toast.info(
      next ? t("meetings.lowDataModeHint") : t("meetings.cameraOn2"),
    );
  }, [t]);

  const toggleHand = useCallback(() => {
    const c = clientRef.current;
    if (!c) return;
    const next = !handRaised;
    setHandRaised(next);
    c.setHandRaised(next);
  }, [handRaised]);


  /* ============================================================
   * Keyboard
   * ========================================================== */

  /**
   * Every control reachable from the keyboard.
   *
   * Single unmodified letters, because in a meeting your hands are usually not
   * on the mouse and the one thing people need instantly is the microphone.
   * Modifier combinations are deliberately avoided: they collide with the
   * browser's own, and the half-second spent forming one is the half-second
   * somebody is being heard when they did not mean to be.
   *
   * A panel toggles rather than only opening, so the same key that shows the
   * chat puts it away — nobody wants to learn two keys for one panel.
   */
  useEffect(() => {
    if (view !== "live") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Never steal a key from someone typing a message.
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (el?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const togglePanel = (which: Panel) =>
        setPanel((current) => (current === which ? null : which));

      switch (e.key.toLowerCase()) {
        case "m":
          e.preventDefault();
          toggleMic();
          break;
        case "v":
          e.preventDefault();
          toggleCamera();
          break;
        case "s":
          e.preventDefault();
          toggleScreenShare();
          break;
        case "h":
          e.preventDefault();
          toggleHand();
          break;
        case "c":
          e.preventDefault();
          togglePanel("chat");
          break;
        case "p":
          e.preventDefault();
          togglePanel("people");
          break;
        case "d":
          e.preventDefault();
          toggleLowData();
          break;
        case "?":
          e.preventDefault();
          setShortcutsOpen((v) => !v);
          break;
        case "escape":
          // One Escape closes the shortcuts sheet, the next closes a panel, so
          // the key always undoes the most recent thing.
          if (shortcutsOpen) setShortcutsOpen(false);
          else setPanel(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    view,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    toggleHand,
    toggleLowData,
    shortcutsOpen,
  ]);

  /* ============================================================
   * Stage actions (host)
   * ========================================================== */

  const runAction = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      const c = clientRef.current;
      if (!c) return null;
      setBusyStage(true);
      const res = await c.action(action, payload);
      setBusyStage(false);
      if (!res.ok && res.error) toast.error(res.error);

      /*
       * See it the moment it is true, rather than on the next poll.
       *
       * The reply to a stage or spotlight action already carries the new state
       * and the time the server believed it — so the person who just shared a
       * verse is the first to see it, not the last. `applyRoomState` keeps a
       * slower reply from undoing it.
       */
      if (res.ok) {
        applyRoomState(typeof res.at === "string" ? res.at : undefined, {
          ...(res.stage !== undefined ? { stage: res.stage } : {}),
          ...("spotlightPeerId" in res
            ? {
                spotlightPeerId:
                  typeof res.spotlightPeerId === "string" ? res.spotlightPeerId : null,
              }
            : {}),
        });
      }
      return res;
    },
    [applyRoomState],
  );

  /** "Let in" or "No", and the entry goes at once rather than on the next poll. */
  const answerKnock = useCallback(
    async (action: "admit" | "deny", participantId: string) => {
      const res = await runAction(action, { participantId });
      if (res?.ok) setAnswered((prev) => new Set(prev).add(participantId));
    },
    [runAction],
  );

  /*
   * The host's own hand too: the "lower-hands" broadcast reaches everybody
   * else, but the server never echoes a peer's own signal back to it.
   */
  const lowerAllHands = useCallback(async () => {
    const res = await runAction("lower-hands");
    if (res?.ok) setHandRaised(false);
  }, [runAction]);

  /**
   * Say something, and see that you said it.
   *
   * The server broadcasts to the room but never back to the sender, so the
   * message is appended here from what the action returns. `onChat` keys on
   * the id, so this cannot double up.
   */
  const sendChat = useCallback(
    async (body: string) => {
      const res = await runAction("chat", { body });
      if (!res?.ok) return;
      const id = typeof res.id === "string" ? res.id : crypto.randomUUID();
      const createdAt =
        typeof res.createdAt === "string" ? res.createdAt : new Date().toISOString();
      setMessages((prev) =>
        prev.some((m) => m.id === id)
          ? prev
          : [
              ...prev,
              {
                id,
                authorName: me?.name ?? "You",
                body,
                kind: "chat",
                createdAt,
              },
            ],
      );
    },
    [runAction, me],
  );

  /* ============================================================
   * Recording
   *
   * Made by the recording service on the server, which hears the room through
   * the media server. This browser only presses Record and Stop: there is no
   * canvas here, no file, no upload, and nothing a sleeping phone or a closed
   * tab can lose. When the service cannot take a recording the server says so
   * at once, and `runAction` shows the host that sentence.
   * ========================================================== */

  const startRecording = useCallback(
    async (mode: RecordingMode) => {
      if (!meeting || !me) return;
      /*
       * One press at a time, and the guard has to be synchronous: the REC pill
       * only appears once the server has answered, so on a slow connection a
       * host who saw nothing happen pressed again.
       */
      if (startingRecordingRef.current || recordingRef.current) return;
      startingRecordingRef.current = true;
      try {
        const res = await runAction("recording.start", { mode });
        if (!res?.ok) return;
        const next = {
          id: typeof res.recordingId === "string" ? res.recordingId : null,
          mode,
          startedAt: typeof res.startedAt === "string" ? Date.parse(res.startedAt) : Date.now(),
        };
        // The ref as well, at once: the guard above has to see it before the
        // next render, or a second tap asks again.
        recordingRef.current = next;
        setRecording(next);
        setRecordingElapsed(0);
        toast.success(
          res.already ? t("meetings.recordingStarted", { name: t("meetings.host") }) : t("meetings.recordingOnServer"),
          { duration: 8000 },
        );
      } finally {
        startingRecordingRef.current = false;
      }
    },
    [meeting, me, runAction, t],
  );

  const stopRecording = useCallback(async () => {
    const res = await runAction("recording.stop", { recordingId: recording?.id ?? undefined });
    // `runAction` has already said why. The recording is still running on the
    // server, so the pill stays and Stop can be pressed again.
    if (!res?.ok) return;
    recordingRef.current = null;
    setRecording(null);
    toast.info(t("meetings.recordingSavingOnServer"), { duration: 8000 });
  }, [runAction, recording, t]);

  /** What is still only on this device, from the old in-browser recorder. */
  const refreshUnsaved = useCallback(async () => {
    setUnsaved(await listPending());
  }, []);

  /*
   * Read the vault once on mount. Guarded rather than fire-and-forget so a
   * room that unmounts mid-read does not set state on a gone component.
   */
  useEffect(() => {
    let live = true;
    listPending()
      .then((rows) => {
        if (live) setUnsaved(rows);
      })
      .catch((e: unknown) => {
        // A private window, or storage the browser refuses: nothing to show.
        console.warn("[meetings] could not read recordings left on this device", e);
        if (live) setUnsaved([]);
      });
    return () => {
      live = false;
    };
  }, []);

  /*
   * Tell the rest of the app a meeting is running.
   *
   * The background recording uploader yields its bandwidth while this is set,
   * and takes it back when the call ends. On the document element because that
   * uploader lives above this component and on every page — see
   * components/meetings/recording-uploader.tsx.
   */
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.meetingLive = "1";
    return () => {
      delete root.dataset.meetingLive;
      delete root.dataset.meetingOutgoingBitrate;
      delete root.dataset.meetingLoss;
    };
  }, []);

  /**
   * A recording left on this device: the background uploader already has it in
   * hand (it reads the same vault), so "save" is a matter of saying so and
   * showing the list again.
   */
  const queueUnsaved = useCallback(() => {
    void refreshUnsaved();
    toast.success(t("meetings.recordingQueued"));
  }, [refreshUnsaved, t]);

  /**
   * End it for the room.
   *
   * The order matters. The server is told first, because if that fails — a host
   * on a dropped connection — nothing should have happened: they are still in
   * the meeting, the recording is still running, and the error says so. Only
   * once the room is actually closed is the recording wound up and this browser
   * taken out, by the same route as every other ending.
   */
  const endForEveryone = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    setEndingForAll(true);
    const res = await runAction("end");
    setEndingForAll(false);
    // `runAction` has already said why. Staying in the call is the right
    // outcome: the meeting has not ended, so neither has this.
    if (!res?.ok) return;
    setConfirmLeave(false);
    client.endLocally("You ended the meeting for everyone.");
  }, [runAction]);

  /* ============================================================
   * Screens
   * ========================================================== */

  if (view === "join") {
    return (
      <>
        <JoinScreen
          title={props.title}
          churchName={props.churchName}
          churchLogo={props.churchLogo}
          defaultName={props.defaultName}
          needsPasscode={props.needsPasscode}
          needsSignIn={props.membersOnly && !props.signedIn}
          lowDataDefault={props.lowDataDefault}
          mediaLocked={props.mediaLocked}
          error={joinError}
          joining={joining}
          onJoin={join}
          signInHref={props.signInHref}
        />
        <Toaster />
      </>
    );
  }

  if (view === "lobby") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-white">
        <div className="size-14 animate-pulse rounded-full bg-indigo-500/30" />
        <h1 className="text-xl font-bold">{t("meetings.waitingForHost")}</h1>
        <p className="max-w-sm text-sm text-slate-400">
          {t("meetings.waitingForHostHint")}
        </p>
        <Button variant="secondary" onClick={leave}>
          {t("meetings.leave")}
        </Button>
        <Toaster />
      </div>
    );
  }

  if (view === "ended") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-white">
        <PhoneOff className="size-10 text-slate-500" />
        <h1 className="text-xl font-bold">
          {endedReason || t("meetings.meetingEnded")}
        </h1>
        {savingOnServer && (
          <p className="max-w-sm rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
            {t("meetings.recordingSavingOnServer")}
          </p>
        )}
        {/*
          Recordings the old in-browser recorder left on this device whose
          upload never finished. Nothing records in the browser any more, but a
          file already here is somebody's service, so it is offered back until
          the background uploader has taken it.
        */}
        {unsaved.length > 0 && (
          <div className="w-full max-w-sm rounded-xl border border-white/10 bg-white/5 p-4 text-left">
            <p className="text-sm font-semibold">{t("meetings.unsavedRecordings")}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              {t("meetings.unsavedExplain")}
            </p>
            <ul className="mt-3 space-y-2">
              {unsaved.map((u) => (
                <li key={u.id} className="rounded-lg border border-white/10 p-2.5">
                  <p className="truncate text-xs font-semibold">{u.meetingTitle}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
                    {formatDuration(u.durationSec)} · {formatBytes(u.bytes)}
                    {u.lastError ? ` · ${u.lastError}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={queueUnsaved}>
                      {t("meetings.saveToLibrary")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => downloadEntry(u)}>
                      <Download className="size-4" /> {t("common.download")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-2">
          {rejoinable && (
            <Button variant="secondary" onClick={() => window.location.reload()}>
              <RefreshCcw className="size-4" /> {t("meetings.rejoin")}
            </Button>
          )}
          {props.manageHref && (
            <Button asChild>
              <a href={props.manageHref}>{t("meetings.backToMeetings")}</a>
            </Button>
          )}
        </div>
        <Toaster />
      </div>
    );
  }

  /* ------------------------------------------------------------ live */

  /*
   * What the big tile shows.
   *
   * The host's spotlight wins over a personal pin, and that is the whole
   * point of it: when the host puts the preacher up, everybody is looking at
   * the preacher. Clearing it hands each person back whatever they had chosen
   * for themselves, rather than dumping the room back to the grid.
   */
  const focus = spotlight ?? pinned;

  const tiles = [
    ...(focus ? others.filter((r) => r.peerId === focus) : []),
    ...others.filter((r) => !focus || r.peerId !== focus),
  ];
  const cols = tileColumns(
    tiles.length + 1,
    typeof window === "undefined" ? 1024 : window.innerWidth,
  );


  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-950 text-white">
      {/* Audio sinks: kept out of the tiles so a voice keeps playing even when
          the person's tile is scrolled away or their camera is off. */}
      {[...media.values()].map((m) => (
        <AudioSink key={m.peerId} peerId={m.peerId} stream={m.stream} onHeld={reportSoundHeld} />
      ))}

      {/*
        The uploader, here as well as in the app shell, for recordings the old
        in-browser recorder left on this device. A meeting lives at
        /meet/<code>, outside the app shell, and a host who only ever opens the
        meeting link would otherwise never upload them. It does nothing once the
        device holds none.
      */}
      <RecordingUploader />

      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-bold sm:text-base">{props.title}</h1>
            {/*
              In the room as well as in the menu. Most people in a meeting
              arrived from a link in WhatsApp and have never seen the rest of
              the platform, so this is the only place they could be told.
            */}
            <BetaBadge tone="dark" />
          </div>
          <p className="flex items-center gap-2 text-[11px] text-slate-400">
            <span>{formatDuration(elapsed)}</span>
            <span aria-hidden>·</span>
            <span>{t("common.people", { count: roster.length })}</span>
            {local?.lowData && (
              <>
                <span aria-hidden>·</span>
                <span className="text-emerald-400">{t("meetings.lowData")}</span>
              </>
            )}
            {/*
              Said in the room, not only at the door. Somebody who joined an
              hour ago and now wants to say something needs to know why the
              button is dead, and the alternative is them tapping it and
              nothing happening.
            */}
            {local && !local.rights.mic && (
              <>
                <span aria-hidden>·</span>
                <span className="text-amber-400">{t("meetings.micLocked")}</span>
              </>
            )}
          </p>
        </div>

        {recording && (
          <span className="flex items-center gap-1.5 rounded-full bg-rose-500/20 px-2.5 py-1 text-[11px] font-bold text-rose-300">
            <Circle className="size-2.5 animate-pulse fill-current" />
            REC {formatDuration(recordingElapsed)}
          </span>
        )}

        <ConnectionPill
          quality={local?.quality ?? "good"}
          transport={transport}
          t={t}
        />
      </header>

      {/*
        The browser is holding the sound until a tap. Any tap or key anywhere
        on the page starts it (see playWhenAllowed), so this only has to say
        so — without it, the room looked fine and simply made no sound.
      */}
      {soundHeld.size > 0 && (
        <p
          role="status"
          className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-400/20 bg-amber-500/15 px-3 py-2 text-center text-xs font-semibold text-amber-200"
        >
          <VolumeX className="size-4 shrink-0" />
          {t("meetings.tapToTurnOnSound")}
        </p>
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col gap-2 p-2">
          {showStage && (
            <StageView
              stage={stage}
              screenStream={sharer?.stream ?? null}
              screenOwner={sharer?.name ?? null}
              canControl={canHost}
              onSlide={(index) => void runAction("stage.slide", { index })}
              onClear={() => void runAction("stage.clear")}
              className="min-h-0 flex-1"
            />
          )}

          <div
            className={cn(
              "grid min-h-0 gap-2",
              showStage ? "h-24 grid-flow-col auto-cols-[8rem] overflow-x-auto sm:h-28 sm:auto-cols-[11rem]" : "flex-1",
            )}
            style={showStage ? undefined : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            <VideoTile
              name={me?.name ?? "You"}
              stream={localStream}
              isSelf
              micOn={!!local?.micOn}
              handRaised={handRaised}
              quality={local?.quality ?? "good"}
              lowData={local?.lowData}
              roleLabel={canHost ? t("meetings.host") : null}
              className={showStage ? "" : "min-h-0"}
            />
            {tiles.map((r) => {
              const m = media.get(r.peerId);
              return (
                <VideoTile
                  key={r.peerId}
                  name={r.name}
                  /*
                   * Always, not `hasCamera ? … : null`.
                   *
                   * `hasCamera` asks whether a remote track is unmuted, which
                   * only changes by event, so the picture appearing depended
                   * on a `mute`/`unmute` event firing AND being heard. When it
                   * was not, the stream was never handed to an element at all:
                   * 288 kbit/s arriving, 1404 frames decoded, and an avatar on
                   * screen. The tile shows the avatar until the element paints,
                   * which is the only thing that actually knows whether pixels
                   * exist, so the gate is redundant as well as wrong.
                   */
                  stream={m?.stream ?? null}
                  micOn={r.micOn}
                  handRaised={r.handRaised}
                  speaking={speaking.has(r.peerId)}
                  quality={r.quality}
                  lowData={r.lowData}
                  // They have a camera on and I am not getting it because I am
                  // the one saving data. Without saying so, this is
                  // indistinguishable from a camera that is simply off.
                  hiddenByDataSaver={
                    !!local?.lowData && r.cameraOn && !m?.hasCamera
                  }
                  dataSaverNote={t("meetings.videoOffInDataSaver")}
                  tapToPlay={t("meetings.tapToPlay")}
                  onElement={(state) =>
                    clientRef.current?.reportElement(r.peerId, state)
                  }
                  roleLabel={isHostRole(r.role) ? t("meetings.host") : null}
                  pinned={focus === r.peerId}
                  spotlit={spotlight === r.peerId}
                  onPin={
                    showStage
                      ? undefined
                      : () => setPinned((p) => (p === r.peerId ? null : r.peerId))
                  }
                  // Only a host sees this, because it changes what everybody
                  // else is looking at.
                  onSpotlight={
                    canHost && !showStage
                      ? () =>
                          void runAction("spotlight", {
                            peerId: spotlight === r.peerId ? null : r.peerId,
                          })
                      : undefined
                  }
                  className={showStage ? "" : "min-h-0"}
                />
              );
            })}
          </div>

          {others.length === 0 && !showStage && (
            /*
             * In the flow, not over the tile. Absolutely positioned at the
             * bottom of the stage it landed exactly on the one tile's own name
             * plate, which is absolutely positioned at the bottom of the tile.
             */
            <p className="shrink-0 px-2 pb-1 text-center text-sm text-balance text-slate-500">
              {t("meetings.onlyOneHere")}
            </p>
          )}

          <ShortcutsSheet
            open={shortcutsOpen}
            onClose={() => setShortcutsOpen(false)}
            t={t}
            canRecord={canHost && !!meeting?.allowRecording}
          />

          {/* Floating reactions */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {floaters.map((f) => (
              <span
                key={f.id}
                className="animate-float-up absolute bottom-4 flex flex-col items-center gap-1"
                style={{ left: `${f.left}%` }}
              >
                <span className="text-4xl">{f.emoji}</span>
                <span className="max-w-28 truncate rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
                  {f.name}
                </span>
              </span>
            ))}
          </div>
        </main>

        {/* Desktop panel */}
        {panel && (
          <aside className="hidden w-80 shrink-0 border-l border-white/10 lg:flex lg:flex-col">
            <PanelHeader panel={panel} onClose={() => setPanel(null)} t={t} />
            <div className="min-h-0 flex-1">{renderPanel()}</div>
          </aside>
        )}
      </div>

      {/* Mobile panel: a sheet over everything. Deliberately a sibling of the
          header rather than a child of it — a `backdrop-filter` ancestor would
          become the containing block for a fixed child and the sheet would
          open inside the header instead of the viewport. */}
      {panel && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end lg:hidden">
          <button
            type="button"
            aria-label="Close panel"
            className="flex-1 bg-black/60"
            onClick={() => setPanel(null)}
          />
          <div className="flex h-[72dvh] flex-col rounded-t-2xl border-t border-white/10 bg-slate-950 pb-[env(safe-area-inset-bottom)]">
            <PanelHeader panel={panel} onClose={() => setPanel(null)} t={t} />
            <div className="min-h-0 flex-1">{renderPanel()}</div>
          </div>
        </div>
      )}

      {/* Controls */}
      <footer className="shrink-0 border-t border-white/10 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-center gap-1.5 sm:gap-2">
          {/*
            A locked microphone is a dead button with a reason on it, exactly
            as the camera is in Data Saver — not a live button that refuses.
            `danger` comes off it too: red means "you are muted and could
            unmute", and there is nothing here to act on.
          */}
          <ControlButton
            active={!!local?.micOn}
            danger={!local?.micOn && local?.rights.mic !== false}
            disabled={local?.rights.mic === false}
            label={
              local?.rights.mic === false
                ? t("meetings.micLockedHint")
                : local?.micOn
                  ? t("meetings.mute")
                  : t("meetings.unmute")
            }
            shortcut="M"
            onClick={toggleMic}
          >
            {local?.micOn ? <Mic /> : <MicOff />}
          </ControlButton>

          <ControlButton
            active={!!local?.cameraOn}
            danger={!local?.cameraOn && local?.rights.camera !== false}
            disabled={local?.lowData || local?.rights.camera === false}
            label={
              local?.rights.camera === false
                ? t("meetings.cameraLockedHint")
                : local?.cameraOn
                  ? t("meetings.cameraOff2")
                  : t("meetings.cameraOn2")
            }
            shortcut="V"
            onClick={toggleCamera}
          >
            {local?.cameraOn ? <Video /> : <VideoOff />}
          </ControlButton>

          {meeting?.allowScreenShare && screenShareable && (
            <ControlButton
              active={!!local?.sharing}
              label={
                local?.sharing
                  ? t("meetings.stopSharing")
                  : t("meetings.shareScreen")
              }
              shortcut="S"
              onClick={toggleScreenShare}
              className="hidden sm:flex"
            >
              <MonitorUp />
            </ControlButton>
          )}

          <ControlButton
            active={handRaised}
            label={handRaised ? t("meetings.lowerHand") : t("meetings.raiseHand")}
            shortcut="H"
            onClick={toggleHand}
          >
            <Hand />
          </ControlButton>

          <ControlButton
            active={panel === "people"}
            label={t("meetings.people")}
            badge={waiting.length || undefined}
            onClick={() => setPanel((p) => (p === "people" ? null : "people"))}
          >
            <Users />
          </ControlButton>

          {meeting?.allowChat && (
            <ControlButton
              active={panel === "chat"}
              label={t("meetings.chat")}
              badge={panel === "chat" ? undefined : unread || undefined}
              onClick={() => {
                setPanel((p) => (p === "chat" ? null : "chat"));
                setUnread(0);
              }}
            >
              <MessageSquare />
            </ControlButton>
          )}

          {canHost && (
            <ControlButton
              active={panel === "share"}
              label={t("meetings.shareToScreen")}
              onClick={() => setPanel((p) => (p === "share" ? null : "share"))}
            >
              <Presentation />
            </ControlButton>
          )}

          <MoreMenu
            t={t}
            canHost={canHost}
            allowReactions={!!meeting?.allowReactions}
            allowRecording={!!meeting?.allowRecording}
            allowScreenShare={!!meeting?.allowScreenShare && screenShareable}
            recording={!!recording}
            cameraOn={!!local?.cameraOn}
            sounds={sounds}
            onReact={react}
            onToggleLowData={toggleLowData}
            onToggleSounds={toggleSounds}
            onFlipCamera={() => void clientRef.current?.flipCamera()}
            onToggleScreen={toggleScreenShare}
            onStartRecording={startRecording}
            onStopRecording={stopRecording}
            // The same sheet as the red button, rather than a browser
            // `confirm()` — one way to end a meeting, and one that says what
            // ending it for everyone actually does.
            onEndForAll={() => setConfirmLeave(true)}
            onCopyLink={() => {
              void navigator.clipboard
                .writeText(window.location.href)
                .then(() => toast.success(t("common.copied")))
                .catch(() => toast.error(t("common.somethingWentWrong")));
            }}
          />

          <Button
            variant="destructive"
            size="icon-lg"
            onClick={() => setConfirmLeave(true)}
            aria-label={canHost ? t("meetings.leaveOrEnd") : t("meetings.leave")}
            className="ml-1 rounded-full"
          >
            <LogOut />
          </Button>
        </div>
      </footer>

      {/*
        The way out asks rather than acts, for two different reasons.

        For anybody: somebody who opened this link from WhatsApp is one tap from
        being out of the call, and "back" is the button people press to close a
        thing they just opened — so it has to mean "are you sure", not
        "goodbye".

        For a host it is not a confirmation at all but a choice, because leaving
        and ending the meeting are two different things and the red button can
        only mean one of them. It used to mean "leave", with "End for everyone"
        hidden in a menu behind a browser `confirm()` — so a host who thought
        they had closed the meeting had merely walked out of it, leaving the room
        open behind them. Ending is offered first and stated plainly; leaving
        keeps the meeting running; staying is always a tap away.
      */}
      {confirmLeave && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onClick={() => {
            if (!endingForAll) setConfirmLeave(false);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 w-full max-w-sm rounded-2xl p-5 text-white ring-1 ring-white/10"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
          >
            <p className="text-lg font-bold">
              {canHost ? t("meetings.leaveOrEnd") : t("meetings.leaveThisMeeting")}
            </p>
            <p className="mt-1 text-sm text-slate-400">
              {canHost
                ? t("meetings.leaveOrEndHint")
                : t("meetings.leaveThisMeetingHint")}
            </p>

            <div className="mt-4 flex flex-col gap-2">
              {canHost && (
                <Button
                  variant="destructive"
                  className="w-full"
                  disabled={endingForAll}
                  onClick={() => void endForEveryone()}
                >
                  {endingForAll ? (
                    <>
                      <Loader2 className="animate-spin" />
                      {t("meetings.endingForEveryone")}
                    </>
                  ) : (
                    <>
                      <PhoneOff />
                      {t("meetings.endForEveryone")}
                    </>
                  )}
                </Button>
              )}
              <Button
                variant={canHost ? "secondary" : "destructive"}
                className="w-full"
                disabled={endingForAll}
                onClick={() => {
                  setConfirmLeave(false);
                  leave();
                }}
              >
                <LogOut />
                {canHost ? t("meetings.leaveJustMe") : t("meetings.leave")}
              </Button>
              <Button
                variant="ghost"
                className="w-full text-slate-300 hover:text-white"
                disabled={endingForAll}
                onClick={() => setConfirmLeave(false)}
              >
                {t("meetings.stayInMeeting")}
              </Button>
            </div>

            {canHost && (
              <p className="mt-3 text-center text-xs text-slate-500">
                {t("meetings.endForEveryoneHint")}
              </p>
            )}
          </div>
        </div>
      )}

      <Toaster />
    </div>
  );

  function renderPanel() {
    if (panel === "chat")
      return (
        <ChatPanel
          messages={messages}
          disabled={!meeting?.allowChat}
          onSend={(body) => void sendChat(body)}
          people={mentionables}
          myName={me?.name}
        />
      );
    if (panel === "people")
      return (
        <PeoplePanel
          // Only people actually in the room. Somebody still waiting is listed
          // above, with a Let in button; under "In the meeting" they had none.
          roster={roster.filter((r) => r.admitted)}
          waiting={waiting}
          myPeerId={me?.peerId ?? ""}
          canHost={canHost}
          onMute={(participantId) => void runAction("mute", { participantId })}
          onRemove={(participantId) => void runAction("remove", { participantId })}
          onPromote={(participantId, role) => void runAction("promote", { participantId, role })}
          onAdmit={(participantId) => void answerKnock("admit", participantId)}
          onDeny={(participantId) => void answerKnock("deny", participantId)}
          onMuteAll={() => void runAction("mute")}
          onLowerHands={() => void lowerAllHands()}
          diagnostics={diagnostics}
          // Read when the panel opens rather than watched: it changes only
          // when this device has just had a very bad second, and re-rendering
          // the room for it would be its own small irony.
          deviceStall={worstStall()}
          attendeeMediaLocked={
            meeting?.allowAttendeeMic === false ||
            meeting?.allowAttendeeCamera === false
          }
        />
      );
    if (panel === "share" && me)
      return (
        <SharePanel
          code={props.code}
          peerId={me.peerId}
          secret={me.secret}
          busy={busyStage}
          hasStage={stage.kind !== "none"}
          onVerse={(input) => void runAction("stage.verse", input)}
          onNote={(input) => void runAction("stage.text", { title: input.title, body: input.body })}
          onSlides={(slides) => void runAction("stage.slides", { slides })}
          onClear={() => void runAction("stage.clear")}
        />
      );
    return null;
  }
}

/**
 * The engine reports why a call ended in English, because it has no dictionary
 * and no business carrying one — it is transport, not interface. This is the one
 * place those sentences become the reader's language, and anything unrecognised
 * passes through unchanged so a new reason still says something true.
 */
function endedMessage(reason: string, t: TFunction): string {
  // "You were removed" is what the engine says when /sync answers `removed`.
  if (reason.includes("removed you") || reason.includes("were removed"))
    return t("meetings.youWereRemoved");
  if (reason.includes("host ended")) return t("meetings.hostEnded");
  if (reason.includes("has ended")) return t("meetings.meetingEnded");
  if (reason.includes("left the meeting")) return t("meetings.youLeft");
  if (reason.includes("signed out")) return t("common.somethingWentWrong");
  return reason;
}

/* ============================================================
 * Small pieces
 * ========================================================== */

/**
 * One peer's voice. Held by the browser until a tap, when it has to be — and
 * the room is told, so it can say "tap to turn the sound on" instead of
 * leaving a listener watching a silent preacher.
 */
function AudioSink({
  peerId,
  stream,
  onHeld,
}: {
  peerId: string;
  stream: MediaStream;
  onHeld: (peerId: string, held: boolean) => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    const stop = playWhenAllowed(el, "meeting audio", (held) => onHeld(peerId, held));
    return () => {
      stop();
      // A voice that has gone is not one the room is waiting to hear.
      onHeld(peerId, false);
    };
  }, [peerId, stream, onHeld]);
  return <audio ref={ref} autoPlay playsInline className="hidden" />;
}

function PanelHeader({
  panel,
  onClose,
  t,
}: {
  panel: Panel;
  onClose: () => void;
  t: TFunction;
}) {
  const title =
    panel === "chat"
      ? t("meetings.chat")
      : panel === "people"
        ? t("meetings.people")
        : t("meetings.shareToScreen");
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2.5">
      <h2 className="text-sm font-bold">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
        className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function ConnectionPill({
  quality,
  transport,
  t,
}: {
  quality: MeetingQuality;
  transport: "online" | "retrying" | "offline";
  t: TFunction;
}) {
  if (transport !== "online") {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-1 text-[11px] font-bold text-amber-300">
        <span className="size-2 animate-pulse rounded-full bg-amber-400" />
        {transport === "retrying"
          ? t("meetings.reconnecting")
          : t("common.offline")}
      </span>
    );
  }
  const Icon = quality === "good" ? Signal : quality === "fair" ? SignalMedium : SignalLow;
  const tone =
    quality === "good"
      ? "text-emerald-400"
      : quality === "fair"
        ? "text-amber-400"
        : "text-rose-400";
  return (
    <span className={cn("flex items-center gap-1 text-[11px] font-semibold", tone)}>
      <Icon className="size-4" />
      <span className="hidden sm:inline">
        {quality === "good"
          ? t("meetings.connectionGood")
          : quality === "fair"
            ? t("meetings.connectionWeak")
            : t("meetings.connectionVeryWeak")}
      </span>
    </span>
  );
}

function ControlButton({
  children,
  label,
  onClick,
  active,
  danger,
  disabled,
  badge,
  className,
  shortcut,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  badge?: number;
  className?: string;
  /** The key that does the same thing, shown on hover. */
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      /*
       * The key goes in the tooltip, not the accessible name: a screen reader
       * announcing "Mute (M)" on every control is noise, and the shortcuts
       * sheet is the discoverable route for anyone not using a mouse.
       */
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active}
      className={cn(
        "relative flex size-11 items-center justify-center rounded-full transition disabled:opacity-40 sm:size-12 [&_svg]:size-5",
        danger
          ? "bg-rose-500 text-white hover:bg-rose-600"
          : active
            ? "bg-indigo-500 text-white hover:bg-indigo-600"
            : "bg-white/10 text-white hover:bg-white/20",
        className,
      )}
    >
      {children}
      {badge ? (
        <span className="absolute -top-0.5 -right-0.5 flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold">
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </button>
  );
}

function MoreMenu({
  t,
  canHost,
  allowReactions,
  allowRecording,
  allowScreenShare,
  recording,
  cameraOn,
  sounds,
  onReact,
  onToggleLowData,
  onToggleSounds,
  onFlipCamera,
  onToggleScreen,
  onStartRecording,
  onStopRecording,
  onEndForAll,
  onCopyLink,
}: {
  t: TFunction;
  canHost: boolean;
  allowReactions: boolean;
  allowRecording: boolean;
  allowScreenShare: boolean;
  recording: boolean;
  cameraOn: boolean;
  /** Whether this device currently plays the arrival and departure notes. */
  sounds: boolean;
  onReact: (emoji: string) => void;
  onToggleLowData: () => void;
  onToggleSounds: () => void;
  onFlipCamera: () => void;
  onToggleScreen: () => void;
  onStartRecording: (mode: RecordingMode) => void;
  onStopRecording: () => void;
  onEndForAll: () => void;
  onCopyLink: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("nav.more")}
          className="flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:size-12 [&_svg]:size-5"
        >
          <MoreHorizontal />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-60">
        {allowReactions && (
          <>
            <div className="flex flex-wrap gap-1 p-1.5">
              {REACTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => onReact(r)}
                  aria-label={r}
                  className="rounded-md p-1.5 text-xl hover:bg-accent"
                >
                  {r}
                </button>
              ))}
            </div>
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuItem onClick={onToggleLowData}>
          <Signal className="size-4" />
          {t("meetings.lowDataMode")}
        </DropdownMenuItem>

        {/*
          The label says what tapping will do, and the icon says where things
          stand. A menu item reading "Join and leave sounds" tells somebody who
          wants them off nothing about whether they already are.
        */}
        <DropdownMenuItem onClick={onToggleSounds}>
          {sounds ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          {sounds ? t("meetings.soundsOff") : t("meetings.soundsOn")}
        </DropdownMenuItem>

        {cameraOn && (
          <DropdownMenuItem onClick={onFlipCamera}>
            <SwitchCamera className="size-4" /> {t("meetings.flipCamera")}
          </DropdownMenuItem>
        )}

        {allowScreenShare && (
          <DropdownMenuItem onClick={onToggleScreen} className="sm:hidden">
            <MonitorUp className="size-4" /> {t("meetings.shareScreen")}
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={onCopyLink}>
          <MessageSquare className="size-4" /> {t("common.copyLink")}
        </DropdownMenuItem>

        {canHost && allowRecording && (
          <>
            <DropdownMenuSeparator />
            {recording ? (
              <DropdownMenuItem onClick={onStopRecording}>
                <Circle className="size-4 fill-current text-rose-500" />{" "}
                {t("meetings.stopRecording")}
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onClick={() => onStartRecording("video")}>
                  <Circle className="size-4 text-rose-500" />{" "}
                  {t("meetings.recordVideo")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onStartRecording("audio")}>
                  <Mic className="size-4" /> {t("meetings.recordAudioOnly")}
                </DropdownMenuItem>
              </>
            )}
          </>
        )}

        {canHost && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onEndForAll}>
              <PhoneOff className="size-4" /> {t("meetings.endForEveryone")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
