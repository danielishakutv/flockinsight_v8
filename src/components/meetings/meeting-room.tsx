"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";
import type { TFunction } from "@/lib/i18n/translate";

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
    allowRecording: boolean;
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
};

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

  const [session, setSession] = useState<JoinResponse | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [media, setMedia] = useState<Map<string, RemoteMedia>>(new Map());
  const [stage, setStage] = useState<Stage>(EMPTY_STAGE);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [local, setLocal] = useState<LocalState | null>(null);
  const [transport, setTransport] = useState<"online" | "retrying" | "offline">("online");
  const [panel, setPanel] = useState<Panel>(null);
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
  /** Asked before the back gesture takes somebody out of a live call. */
  const [confirmLeave, setConfirmLeave] = useState(false);
  /** What the host has put on the main screen for the whole room. */
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busyStage, setBusyStage] = useState(false);
  const [floaters, setFloaters] = useState<{ id: string; emoji: string; left: number }[]>([]);
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

  /** A reaction someone tapped, drifting up the screen and gone. */
  function addFloater(emoji: string) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setFloaters((f) => [...f, { id, emoji, left: 10 + Math.random() * 70 }]);
    setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 2600);
  }

  function react(emoji: string) {
    clientRef.current?.react(emoji);
    addFloater(emoji);
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
            onReaction: (_peer, emoji) => addFloater(emoji),
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
              setPhase("ended");
            },
            onError: (message) => toast.error(message),
            onMediaFault: (fault, device) => reportMediaFault(fault, device),
            onTransport: setTransport,
          },
        });

        clientRef.current = client;
        client.start();
        setLocal(client.currentState());

        if (data.me.micOn) await client.setMic(true);
        if (data.me.cameraOn) await client.setCamera(true);
        setLocalStream(client.localStreams().camera);

        setPhase(data.me.admitted ? "live" : "lobby");
      } catch {
        setJoinError(t("common.offline"));
      } finally {
        setJoining(false);
      }
    },
    [props.code, props.hostKey, t, reportMediaFault],
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

  const leave = useCallback(async () => {
    const client = clientRef.current;
    if (recorderRef.current?.running) {
      const result = await recorderRef.current.stop();
      if (result) downloadRecording(result);
    }
    client?.leave();
    await client?.stop();
    clientRef.current = null;
    setEndedReason(t("meetings.youLeft"));
    setPhase("ended");
  }, [t]);

  /*
   * A recording that could not be stored lives in this tab and nowhere else,
   * so closing it destroys the only copy. This is the one case in the whole
   * app that earns a `beforeunload` prompt: the browser's wording is not ours
   * to choose and people rightly resent these, but losing a recording of a
   * service to a stray Cmd-W is worse than an ugly dialog.
   */
  useEffect(() => {
    if (!pendingSave || !saveProblem) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pendingSave, saveProblem]);

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

  const toggleMic = useCallback(() => {
    const c = clientRef.current;
    if (!c) return;
    void c.setMic(!c.currentState().micOn);
  }, []);

  const toggleCamera = useCallback(() => {
    const c = clientRef.current;
    if (!c) return;
    void c.setCamera(!c.currentState().cameraOn).then(() =>
      setLocalStream(c.localStreams().camera),
    );
  }, []);

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

  useEffect(() => {
    if (phase !== "live") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Never steal a key from someone typing a message.
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (el?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        toggleMic();
      }
      if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        toggleCamera();
      }
      if (e.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, toggleMic, toggleCamera]);

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

  const saveRecording = useCallback(
    async (file: PendingSave) => {
      if (!me) return;

      setSavingRecording(true);
      setSaveProblem(null);
      try {
        const form = new FormData();
        form.set("peer", me.peerId);
        form.set("secret", me.secret);
        form.set("recordingId", file.recordingId ?? "");
        form.set("durationSec", String(file.durationSec));
        form.set("mode", file.mode);
        form.set("file", file.blob, file.filename);

        const res = await fetch(`/api/meet/${props.code}/recording`, {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (data.ok) {
          toast.success(t("meetings.savedToLibrary"));
          setPendingSave(null);
          return;
        }
        // The server knows why — too big, no media storage configured, quota
        // full — and every one of those is something the host can act on.
        // Its sentence beats anything generic this end could write.
        setSaveProblem(data.error ?? t("common.somethingWentWrong"));
      } catch {
        setSaveProblem(t("meetings.recordingUploadFailed"));
      } finally {
        setSavingRecording(false);
      }
    },
    [me, props.code, t],
  );

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const result = await recorder.stop();
    recorderRef.current = null;
    await runAction("recording.stop");
    // Carry the id and the mode over to the file BEFORE clearing the state:
    // the upload needs them, and `setRecording(null)` used to run first, so
    // every upload posted an empty id and the row never left "uploading".
    if (result) {
      const pending = {
        ...result,
        recordingId: recording?.id ?? null,
        mode: recording?.mode ?? "video",
      };
      setPendingSave(pending);
      // Straight to the library. Stopping a recording is already the decision
      // to keep it, and a button between the two is how a recording of a
      // service is lost to a closed tab.
      void saveRecording(pending);
    }
    setRecording(null);
  }, [runAction, recording, saveRecording]);


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
              <p className="text-muted-foreground mt-1 flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="size-3.5 animate-spin" />
                {t("meetings.savingToLibrary")}
              </p>
            )}

            {saveProblem && (
              <>
                <p className="mt-1 text-xs leading-relaxed text-amber-200">
                  {saveProblem}
                </p>
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
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => window.location.reload()}>
            <RefreshCcw className="size-4" /> {t("meetings.rejoin")}
          </Button>
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
          <h1 className="truncate text-sm font-bold sm:text-base">{props.title}</h1>
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

          {/* Floating reactions */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {floaters.map((f) => (
              <span
                key={f.id}
                className="animate-float-up absolute bottom-4 text-4xl"
                style={{ left: `${f.left}%` }}
              >
                {f.emoji}
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
          <ControlButton
            active={!!local?.micOn}
            danger={!local?.micOn}
            label={local?.micOn ? t("meetings.mute") : t("meetings.unmute")}
            onClick={toggleMic}
          >
            {local?.micOn ? <Mic /> : <MicOff />}
          </ControlButton>

          <ControlButton
            active={!!local?.cameraOn}
            danger={!local?.cameraOn}
            disabled={local?.lowData}
            label={
              local?.cameraOn
                ? t("meetings.cameraOff2")
                : t("meetings.cameraOn2")
            }
            onClick={toggleCamera}
          >
            {local?.cameraOn ? <Video /> : <VideoOff />}
          </ControlButton>

          {meeting?.allowScreenShare && (
            <ControlButton
              active={!!local?.sharing}
              label={
                local?.sharing
                  ? t("meetings.stopSharing")
                  : t("meetings.shareScreen")
              }
              onClick={toggleScreenShare}
              className="hidden sm:flex"
            >
              <MonitorUp />
            </ControlButton>
          )}

          <ControlButton
            active={handRaised}
            label={handRaised ? t("meetings.lowerHand") : t("meetings.raiseHand")}
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
            allowScreenShare={!!meeting?.allowScreenShare}
            recording={!!recording}
            cameraOn={!!local?.cameraOn}
            onReact={react}
            onToggleLowData={toggleLowData}
            onFlipCamera={() => void clientRef.current?.flipCamera()}
            onToggleScreen={toggleScreenShare}
            onStartRecording={startRecording}
            onStopRecording={stopRecording}
            onEndForAll={async () => {
              if (!confirm(t("meetings.endForEveryone"))) return;
              await runAction("end");
            }}
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
            onClick={leave}
            aria-label={t("meetings.leave")}
            className="ml-1 rounded-full"
          >
            <LogOut />
          </Button>
        </div>
      </footer>

      {/*
        The back gesture asks rather than acts. Somebody who opened this link
        from WhatsApp is one tap from being out of the call, and "back" is the
        button people press to close a thing they just opened — so it has to
        mean "are you sure", not "goodbye".
      */}
      {confirmLeave && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onClick={() => setConfirmLeave(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 w-full max-w-sm rounded-2xl p-5 text-white ring-1 ring-white/10"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
          >
            <p className="text-lg font-bold">{t("meetings.leaveThisMeeting")}</p>
            <p className="mt-1 text-sm text-slate-400">
              {t("meetings.leaveThisMeetingHint")}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
              <Button
                variant="destructive"
                className="w-full sm:w-auto"
                onClick={() => {
                  setConfirmLeave(false);
                  void leave();
                }}
              >
                {t("meetings.leave")}
              </Button>
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setConfirmLeave(false)}
              >
                {t("meetings.stayInMeeting")}
              </Button>
            </div>
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
    void el.play().catch(() => {});
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
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  badge?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
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
