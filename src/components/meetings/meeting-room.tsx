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
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatBytes } from "@/lib/storage-bytes";
import {
  type UploadProgress,
} from "@/lib/direct-upload";
import {
  downloadEntry,
  keepRecording,
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
  downloadRecording,
  MeetingRecorder,
  recordingSupported,
  type RecorderMode,
  type RecordingResult,
} from "@/lib/meeting-recorder";
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
import { playMedia } from "@/lib/media-errors";

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

/**
 * A finished recording, plus the two things the upload needs that the recorder
 * itself has no way to know: which row on the server it belongs to, and which
 * mode it was captured in. They used to be read off live state at upload time,
 * which had already been cleared by then.
 */
type PendingSave = RecordingResult & {
  recordingId: string | null;
  mode: RecorderMode;
  /** Its key in the on-device vault, so a confirmed save can release it. */
  vaultId: string;
};

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
   * A mirror of `panel` for the back-gesture listener below. That listener
   * pushes a history entry when it registers, so re-registering it on every
   * panel change would stack up an entry per tap — the ref lets it read the
   * current panel while staying registered once.
   */
  const panelRef = useRef<Panel>(null);
  const [unread, setUnread] = useState(0);
  const [handRaised, setHandRaised] = useState(false);
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
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busyStage, setBusyStage] = useState(false);
  const [floaters, setFloaters] = useState<
    { id: string; emoji: string; left: number; name: string }[]
  >([]);
  const [recording, setRecording] = useState<{ id: string | null; mode: RecorderMode } | null>(null);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [savingRecording, setSavingRecording] = useState(false);
  /**
   * Why the recording is not in the library.
   *
   * Set only when an automatic save has actually failed, so its presence is
   * what turns the panel from "saving" into "this is on your device and
   * nowhere else". That distinction is the difference between a host who
   * downloads the file and a host who closes the tab.
   */
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [unsaved, setUnsaved] = useState<VaultEntry[]>([]);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [waiting, setWaiting] = useState<{ participantId: string; name: string }[]>([]);
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
  const recorderRef = useRef<MeetingRecorder | null>(null);
  /**
   * So the call is wound up exactly once.
   *
   * There are four ways out — the Leave button, the host's End for everyone, a
   * removal, and the news arriving on a poll — and two of them can land within
   * a moment of each other.
   */
  const closingRef = useRef(false);
  /**
   * `stopRecording` is defined much further down, after the pieces it needs,
   * but the teardown above has to be able to call it. A ref rather than a
   * reordering: the teardown is referenced by effects that register before the
   * recording code exists, so moving it would be a use-before-declaration.
   */
  const stopRecordingRef = useRef<(() => Promise<void>) | null>(null);
  const frameRef = useRef({ stage: EMPTY_STAGE as Stage, media, roster, localStream });

  const me = session?.me;
  const meeting = session?.meeting;
  const canHost = isHostRole(me?.role ?? "attendee");

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
      frameRef.current.roster.find((r) => r.peerId === peerId)?.name ??
      t("meetings.someone"),
    [t],
  );

  function react(emoji: string) {
    clientRef.current?.react(emoji);
    addFloater(emoji, t("meetings.you"));
  }

  /** Lobby traffic: who is knocking, and who has been dealt with. */
  function handleControl(payload: Record<string, unknown>) {
    const action = String(payload.action ?? "");
    if (action === "knock" && typeof payload.participantId === "string") {
      const participantId = payload.participantId;
      const name = String(payload.name ?? "Someone");
      setWaiting((w) =>
        w.some((x) => x.participantId === participantId)
          ? w
          : [...w, { participantId, name }],
      );
    }
    if (action === "admitted" || action === "denied") {
      setWaiting((w) => w.filter((x) => x.participantId !== payload.participantId));
    }
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
   * same way whichever of the four endings it was. What is left is up here: a
   * recording that was still writing, and the reference to the engine.
   *
   * A recording in flight goes to the on-device vault and the background
   * uploader, the same route as a recording stopped by hand. It used to be
   * downloaded straight to the host's Downloads folder on the way out, which
   * meant the two endings produced different outcomes and an ended meeting was
   * the one path where a service never reached the library.
   */
  const closeOut = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (recorderRef.current?.running) {
      try {
        await stopRecordingRef.current?.();
      } catch (e) {
        // The blob is in the vault before any of this, so the recording is not
        // lost — but a host who was recording is owed the news either way.
        console.error("[meetings] the recording did not stop cleanly as the call ended", e);
        toast.error(t("meetings.recordingUploadFailed"));
      }
    }
    clientRef.current = null;
  }, [t]);

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
          events: {
            onRoster: setRoster,
            onStage: (s) => setStage(parseStage(s)),
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
            onSpotlight: setSpotlight,
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
            },
            onEnded: (reason) => {
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
               * the moment it reaches this point; the recording is the one thing
               * it cannot know about.
               */
              void closeOut();
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
              if (outcome === "recovered") toast.info(t("meetings.micRecovered"));
              else toast.error(t("meetings.micLost"), { duration: 12000 });
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
    [props.code, props.hostKey, t, reportMediaFault, nameForPeer, closeOut],
  );

  /* ============================================================
   * Lobby → live, and host notifications
   * ========================================================== */



  /* ============================================================
   * Timers
   * ========================================================== */

  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => {
      if (startedAt) setElapsed(Math.round((Date.now() - startedAt) / 1000));
      if (recorderRef.current?.running) {
        setRecordingElapsed(recorderRef.current.elapsedSec);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [phase, startedAt]);

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
      void closeOut();
      return;
    }
    client.leave();
    client.endLocally("You left the meeting.");
  }, [closeOut, t]);

  /*
   * Only while an upload is actually in flight.
   *
   * This prompt used to guard a failed save, because the only copy lived in
   * this tab and closing it destroyed an hour of somebody's service. The file
   * is now in IndexedDB before the first byte is sent, so a closed tab costs
   * nothing and the prompt would be pure nuisance. What it still earns is
   * interrupting a transfer half-way.
   */
  useEffect(() => {
    if (!savingRecording) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [savingRecording]);

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
    if (phase !== "live") return;

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
  }, [phase]);

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
    if (phase !== "live") return;
    const onRotate = () => void clientRef.current?.handleRotation();
    const mql = window.matchMedia("(orientation: portrait)");
    mql.addEventListener("change", onRotate);
    return () => mql.removeEventListener("change", onRotate);
  }, [phase]);

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
   * Derived view state
   * ========================================================== */

  /*
   * Someone in the lobby finds out they are in the moment the roster names
   * them as admitted. Derived rather than pushed into state from an effect —
   * the roster IS the answer, and copying it into a second variable only
   * creates a window where the two disagree.
   */
  const admittedNow =
    !!me && roster.some((r) => r.peerId === me.peerId && r.admitted);
  const view: Phase = phase === "lobby" && admittedNow ? "live" : phase;

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

  // Keep the recorder's view of the world current without re-creating it. In
  // an effect rather than during render: a ref written while rendering is read
  // back at a moment React makes no promises about.
  useEffect(() => {
    frameRef.current = { stage, media, roster, localStream };
  }, [stage, media, roster, localStream]);

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
    if (phase !== "live") return;
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
    phase,
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
      return res;
    },
    [],
  );

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
   * ========================================================== */

  const startRecording = useCallback(
    async (mode: RecorderMode) => {
      if (!meeting || !me) return;
      if (!recordingSupported(mode)) {
        toast.error(t("common.somethingWentWrong"));
        return;
      }

      const recorder = new MeetingRecorder({
        mode,
        churchName: props.churchName,
        meetingTitle: props.title,
        onError: (msg) => toast.error(msg),
        getFrame: () => {
          const f = frameRef.current;
          const screen =
            [...f.media.values()].find((m) => m.hasScreen)?.screenStream ??
            clientRef.current?.localStreams().screen ??
            null;
          const people = [
            {
              id: "me",
              name: `${me.name} (you)`,
              stream: f.localStream,
              muted: !clientRef.current?.currentState().micOn,
              speaking: false,
            },
            ...f.roster
              .filter((r) => r.peerId !== me.peerId && r.admitted)
              .map((r) => ({
                id: r.peerId,
                name: r.name,
                stream: f.media.get(r.peerId)?.stream ?? null,
                muted: !r.micOn,
                speaking: false,
              })),
          ];
          return { stage: f.stage, screen, people };
        },
        getAudioStreams: () => {
          const streams: MediaStream[] = [];
          const mic = clientRef.current?.localStreams().mic;
          if (mic) streams.push(mic);
          for (const [, m] of frameRef.current.media) {
            if (m.stream.getAudioTracks().length > 0) streams.push(m.stream);
          }
          return streams;
        },
      });

      const started = await recorder.start();
      if (!started) return;
      recorderRef.current = recorder;

      const res = await runAction("recording.start", { mode });
      setRecording({ id: (res?.recordingId as string) ?? null, mode });
      setRecordingElapsed(0);
      toast.success(
        t("meetings.recordingStarted", { name: t("meetings.host") }),
      );
    },
    [meeting, me, props.churchName, props.title, runAction, t],
  );

  /** What is still only on this device. */
  const refreshUnsaved = useCallback(async () => {
    setUnsaved(await listPending());
  }, []);

  /*
   * Read the vault once on mount. Guarded rather than fire-and-forget so a
   * room that unmounts mid-read does not set state on a gone component — and
   * so the lint rule can see that nothing is set synchronously here.
   */
  useEffect(() => {
    let live = true;
    listPending()
      .then((rows) => {
        if (live) setUnsaved(rows);
      })
      .catch(() => {
        // A private window, or storage the browser refuses. Nothing to show,
        // and the save path reports its own failures.
        if (live) setUnsaved([]);
      });
    return () => {
      live = false;
    };
  }, []);

  /**
   * Save a recording to the library, straight from this browser.
   *
   * The file goes to Cloudinary directly rather than through our API. Posting
   * it to us meant every video ever recorded died at Cloudflare, which rejects
   * any request body over 100 MB — an hour of video is about three times that,
   * and audio kept working only because an hour of it is around 30 MB. It
   * failed late and quietly, so it read as "still uploading" and then stopped.
   *
   * The blob is in IndexedDB before the first byte is sent, and only removed
   * once the server confirms the media row. If anything goes wrong — here, the
   * network, the laptop lid — the recording is still on this device and the
   * Unsaved recordings panel will offer it back.
   */
  /**
   * Tell the server a recording did not save.
   *
   * Every failing path calls this. Before it existed the browser handled its own
   * errors well — a toast, a note in the local vault — and the row it had created
   * when recording started stayed "uploading" for ever. Eleven production
   * recordings sat like that: zero bytes, no error, and a host who believed they
   * had a recording.
   *
   * Best-effort and never allowed to throw: this runs inside a catch, and a
   * failure to report a failure must not replace the real error with its own.
   * The server's stalled-recording sweep is the backstop for when even this
   * cannot get through.
   */
  const reportRecordingFailure = useCallback(
    async (recordingId: string | null, stage: string, reason: string) => {
      if (!recordingId || !me) return;
      try {
        await fetch(`/api/meet/${props.code}/recording/failed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            peer: me.peerId,
            secret: me.secret,
            recordingId,
            stage,
            reason,
          }),
          // The host often closes the tab the moment they see it failed; this
          // lets the browser deliver it anyway.
          keepalive: true,
        });
      } catch (e) {
        console.error("[meetings] could not report the recording failure", e);
      }
    },
    [me, props.code],
  );

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
   * Hand a finished recording to the background uploader.
   *
   * It used to upload here, straight to Cloudinary, from inside the meeting
   * component. Three things were wrong with that and all three bit:
   *
   *   - Cloudinary will not store a single asset over 100 MB, so any recording
   *     long enough to be worth keeping failed at the last chunk.
   *   - The uploader was mounted inside the meeting, so leaving the call
   *     unmounted it mid-upload.
   *   - Nothing resumed it afterwards. The file sat in the vault until somebody
   *     noticed and pressed a button.
   *
   * The file is already in the vault by the time this runs — written there
   * before a single byte is sent anywhere. So there is nothing to do but say so
   * and let the uploader in the app shell take it: to our own server, in
   * chunks, resumable across sessions, using only spare bandwidth while the
   * call is still running.
   */
  const saveRecording = useCallback(
    async (file: PendingSave) => {
      setSavingRecording(false);
      setUploadProgress(null);
      setSaveProblem(null);
      setPendingSave(null);
      void refreshUnsaved();
      toast.success(t("meetings.recordingQueued"));
      void file;
    },
    [refreshUnsaved, t],
  );

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    /*
     * No recorder, but the server may still think one is running — if this
     * returned silently the row stayed "uploading" for ever. Say so instead.
     */
    if (!recorder) {
      if (recording?.id) {
        await runAction("recording.stop").catch(() => {});
        await reportRecordingFailure(
          recording.id,
          "capture",
          "The recorder was already gone when the host stopped it, so nothing was captured.",
        );
      }
      setRecording(null);
      return;
    }
    const result = await recorder.stop();
    recorderRef.current = null;
    await runAction("recording.stop");
    // Carry the id and the mode over to the file BEFORE clearing the state:
    // the upload needs them, and `setRecording(null)` used to run first, so
    // every upload posted an empty id and the row never left "uploading".
    if (result) {
      const pending: PendingSave = {
        ...result,
        recordingId: recording?.id ?? null,
        mode: recording?.mode ?? "video",
        vaultId:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : String(Date.now()),
      };

      /*
       * On disk before a single byte is uploaded. The moment most likely to
       * lose a recording is the one right here — the host stops recording and
       * closes the laptop — and until now the only copy was a React state
       * variable that a refresh destroyed.
       */
      await keepRecording({
        id: pending.vaultId,
        meetingCode: props.code,
        meetingTitle: props.title,
        recordingId: pending.recordingId,
        mode: pending.mode,
        filename: pending.filename,
        mime: pending.mime,
        durationSec: pending.durationSec,
        bytes: pending.bytes,
        createdAt: Date.now(),
        blob: pending.blob,
      });
      void refreshUnsaved();

      setPendingSave(pending);
      // Straight to the library. Stopping a recording is already the decision
      // to keep it, and a button between the two is how a recording of a
      // service is lost to a closed tab.
      void saveRecording(pending);
    } else {
      /*
       * `stop()` returned nothing — the recorder produced an empty file, or it
       * had already gone. This branch used to do nothing at all, which is how a
       * host could stop a recording, see no error, and leave a row saying
       * "uploading" with zero bytes. It is the exact shape of the eleven stuck
       * recordings found in production.
       */
      const message = t("meetings.recordingEmpty");
      setSaveProblem(message);
      await reportRecordingFailure(recording?.id ?? null, "empty", message);
    }
    setRecording(null);
  }, [
    runAction,
    recording,
    saveRecording,
    props.code,
    props.title,
    refreshUnsaved,
    reportRecordingFailure,
    t,
  ]);


  /*
   * Hand `stopRecording` to the teardown above.
   *
   * In an effect rather than during render: it is wanted by a button press, and
   * every effect has run long before anybody can press one.
   */
  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

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
        {pendingSave && (
          /*
            Three states, and only the third asks anything of the host.
            Saving: it is on its way, nothing to do. Failed: it is in this tab
            and nowhere else, which is said plainly and loudly because the
            alternative is a host who closes the tab believing it was kept.
          */
          <div
            className={cn(
              "w-full max-w-sm rounded-xl border p-4 text-left",
              saveProblem
                ? "border-amber-500/40 bg-amber-500/10"
                : "border-white/10 bg-white/5",
            )}
          >
            <p className="text-sm font-semibold">
              {t("meetings.recordingReady", {
                duration: formatDuration(pendingSave.durationSec),
              })}
            </p>

            {savingRecording && (
              <div className="mt-2">
                <p className="flex items-center gap-2 text-xs text-slate-300">
                  <Loader2 className="size-3.5 animate-spin" />
                  {uploadProgress
                    ? t("meetings.uploadingPercent", {
                        percent: String(uploadProgress.percent),
                      })
                    : t("meetings.savingToLibrary")}
                </p>

                {/*
                  A real bar driven by real bytes. A ten-minute upload with no
                  progress is indistinguishable from a broken one, which is
                  exactly how the old silent failure was experienced.
                */}
                <div
                  className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={uploadProgress?.percent ?? 0}
                  aria-label={t("meetings.savingToLibrary")}
                >
                  <div
                    className="bg-primary h-full rounded-full transition-[width] duration-300"
                    style={{ width: `${uploadProgress?.percent ?? 0}%` }}
                  />
                </div>

                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                  <span className="tabular-nums">
                    {formatBytes(uploadProgress?.uploadedBytes ?? 0)} /{" "}
                    {formatBytes(pendingSave.bytes)}
                    {uploadProgress?.secondsLeft != null &&
                      uploadProgress.secondsLeft > 0 &&
                      ` · ${t("meetings.uploadTimeLeft", {
                        time: formatDuration(uploadProgress.secondsLeft),
                      })}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => uploadAbortRef.current?.abort()}
                    className="font-semibold text-slate-300 underline underline-offset-2"
                  >
                    {t("meetings.cancelUpload")}
                  </button>
                </div>
              </div>
            )}

            {!savingRecording && !saveProblem && (
              <p className="mt-1 text-xs text-slate-400">
                {t("meetings.recordingKeptSafe")}
              </p>
            )}

            {saveProblem && (
              <>
                <p className="mt-1 text-xs leading-relaxed text-amber-200">
                  {saveProblem}
                </p>
                {/*
                  No longer a warning that closing the tab destroys it, because
                  it no longer does: the file is in IndexedDB and the Unsaved
                  recordings panel will still have it tomorrow.
                */}
                <p className="mt-2 text-xs font-semibold text-amber-200">
                  {t("meetings.downloadOrLoseIt")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => downloadRecording(pendingSave)}>
                    <Download className="size-4" /> {t("common.download")}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={savingRecording}
                    onClick={() => void saveRecording(pendingSave)}
                  >
                    {t("common.tryAgain")}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
        {/*
          Anything still only on this device, including recordings from earlier
          meetings whose upload never finished. Until now a failed upload was
          simply gone once the tab closed; this is where it comes back.
        */}
        {unsaved.filter((u) => u.id !== pendingSave?.vaultId).length > 0 && (
          <div className="w-full max-w-sm rounded-xl border border-white/10 bg-white/5 p-4 text-left">
            <p className="text-sm font-semibold">{t("meetings.unsavedRecordings")}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              {t("meetings.unsavedExplain")}
            </p>
            <ul className="mt-3 space-y-2">
              {unsaved
                .filter((u) => u.id !== pendingSave?.vaultId)
                .map((u) => (
                  <li key={u.id} className="rounded-lg border border-white/10 p-2.5">
                    <p className="truncate text-xs font-semibold">{u.meetingTitle}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
                      {formatDuration(u.durationSec)} · {formatBytes(u.bytes)}
                      {u.lastError ? ` · ${u.lastError}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={savingRecording}
                        onClick={() =>
                          void saveRecording({
                            blob: u.blob,
                            mime: u.mime,
                            durationSec: u.durationSec,
                            bytes: u.bytes,
                            filename: u.filename,
                            recordingId: u.recordingId,
                            mode: u.mode,
                            vaultId: u.id,
                          })
                        }
                      >
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
        <AudioSink key={m.peerId} stream={m.stream} />
      ))}

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
            onReact={react}
            onToggleLowData={toggleLowData}
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
          roster={roster}
          waiting={waiting}
          myPeerId={me?.peerId ?? ""}
          canHost={canHost}
          onMute={(participantId) => void runAction("mute", { participantId })}
          onRemove={(participantId) => void runAction("remove", { participantId })}
          onPromote={(participantId, role) => void runAction("promote", { participantId, role })}
          onAdmit={(participantId) => void runAction("admit", { participantId })}
          onDeny={(participantId) => void runAction("deny", { participantId })}
          onMuteAll={() => void runAction("mute")}
          onLowerHands={() => void runAction("lower-hands")}
          diagnostics={diagnostics}
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
  if (reason.includes("removed you")) return t("meetings.youWereRemoved");
  if (reason.includes("host ended")) return t("meetings.hostEnded");
  if (reason.includes("has ended")) return t("meetings.meetingEnded");
  if (reason.includes("left the meeting")) return t("meetings.youLeft");
  if (reason.includes("signed out")) return t("common.somethingWentWrong");
  return reason;
}

/* ============================================================
 * Small pieces
 * ========================================================== */

function AudioSink({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    playMedia(el, "meeting audio");
  }, [stream]);
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
  onReact,
  onToggleLowData,
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
  onReact: (emoji: string) => void;
  onToggleLowData: () => void;
  onFlipCamera: () => void;
  onToggleScreen: () => void;
  onStartRecording: (mode: RecorderMode) => void;
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
