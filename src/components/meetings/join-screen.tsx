"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  Signal,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { initialsOf } from "@/lib/meetings-shared";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import { mediaFault, type MediaFault } from "@/lib/meeting-client";
import { pointerKind } from "@/lib/meetings-shared";
import type { TKey } from "@/lib/i18n/translate";
import { playMedia } from "@/lib/media-errors";
import { BetaBadge } from "@/components/beta-badge";

/**
 * What we ask a device for, in one place.
 *
 * The same constraints are used by the first dialog and by a later camera
 * request, so a camera granted on the second route behaves exactly like one
 * granted on the first.
 */
const AUDIO_WANTED: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
const VIDEO_WANTED: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  facingMode: "user",
};

export type JoinValues = {
  name: string;
  micOn: boolean;
  cameraOn: boolean;
  lowData: boolean;
  passcode: string;
};

/**
 * The room before the room.
 *
 * Every good meeting app has this screen and every bad one doesn't, for one
 * reason: it is where people find out their microphone is the wrong one, in
 * private, instead of in front of forty people. It also lets someone on a
 * hard-up connection choose audio-only BEFORE a camera has ever been opened —
 * which is the difference between joining and giving up.
 */
/**
 * One sentence per way a device can fail to open.
 *
 * "blocked" is the only one that depends on the device, because it is the only
 * one that asks the person to go and change something — and where they go is
 * an icon in a different place on a phone and on a desktop.
 */
export function mediaFaultKey(fault: MediaFault): TKey {
  if (fault === "blocked") {
    return pointerKind() === "touch"
      ? "meetings.mediaBlocked"
      : "meetings.mediaBlockedDesktop";
  }
  const rest = {
    missing: "meetings.mediaMissing",
    inUse: "meetings.mediaInUse",
    unknown: "meetings.mediaUnreachable",
    unsupported: "meetings.mediaUnsupported",
  } as const satisfies Record<Exclude<MediaFault, "blocked">, TKey>;
  return rest[fault];
}

export function JoinScreen({
  title,
  churchName,
  churchLogo,
  defaultName,
  needsPasscode,
  needsSignIn,
  lowDataDefault,
  error,
  joining,
  onJoin,
  signInHref,
}: {
  title: string;
  churchName: string;
  churchLogo: string | null;
  defaultName: string;
  needsPasscode: boolean;
  needsSignIn: boolean;
  lowDataDefault: boolean;
  error: string | null;
  joining: boolean;
  onJoin: (values: JoinValues) => void;
  signInHref: string;
}) {
  const t = useT();
  const [name, setName] = useState(defaultName);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(!lowDataDefault);
  const [lowData, setLowData] = useState(lowDataDefault);
  const [passcode, setPasscode] = useState("");
  /**
   * Why a device did not open, per device.
   *
   * One shared fault used to cover both, which was fine while they were always
   * asked for together and wrong the moment they were not: a camera refused in
   * Data Saver mode would have read as "we couldn't reach your camera and
   * microphone" to somebody whose microphone was working perfectly.
   */
  const [micFault, setMicFault] = useState<MediaFault | null>(null);
  const [camFault, setCamFault] = useState<MediaFault | null>(null);
  /** false while the browser's own dialog is up — nothing else should render yet. */
  const [asked, setAsked] = useState(false);
  /** While a camera dialog this screen asked for a second time is up. */
  const [askingCamera, setAskingCamera] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  /**
   * The microphone and the camera, held apart.
   *
   * They used to be one stream, and the camera was "turned off" by setting
   * `track.enabled = false` — which keeps the track live, and a live video
   * track is a camera light. Separate streams mean the camera can be stopped
   * outright and taken again later, which is the only thing that actually puts
   * the light out.
   */
  const micRef = useRef<MediaStream | null>(null);
  const camRef = useRef<MediaStream | null>(null);
  /** The camera in state as well, so the preview re-attaches when it changes. */
  const [cam, setCam] = useState<MediaStream | null>(null);

  const keepCamera = (stream: MediaStream | null) => {
    camRef.current = stream;
    setCam(stream);
  };

  /** Put the camera down for good. The light goes out when the track stops. */
  const releaseCamera = useCallback(() => {
    camRef.current?.getTracks().forEach((track) => track.stop());
    camRef.current = null;
    setCam(null);
  }, []);

  /*
   * Ask for what is actually going to be used, once, as soon as this screen
   * appears.
   *
   * This is the whole point of a screen before the call: it is where somebody
   * finds out their microphone is the wrong one, in private, instead of in
   * front of forty people. The browser shows ONE dialog per getUserMedia call,
   * so when video is wanted the camera and the microphone are asked for
   * together — two calls would be two dialogs, and the second arrives after
   * the person has stopped reading.
   *
   * In Data Saver mode only the microphone is asked for. It used to ask for
   * both, on the reasoning that permission should be in hand before anybody
   * switched video on mid-call. That was a bad trade: Data Saver exists for the
   * person whose camera is never going on, and it was asking them to grant a
   * camera and then holding the track open — a light on, for a picture nobody
   * would ever be sent. Turning Data Saver off and tapping the camera asks
   * then, which is a dialog the person has that moment asked for.
   */
  useEffect(() => {
    let cancelled = false;
    // Read once: this runs on mount only, and `lowData` changes afterwards.
    const wantsCamera = !lowDataDefault;

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setMicFault("unsupported");
          setCamFault("unsupported");
          setMicOn(false);
          setCameraOn(false);
          setAsked(true);
        }
        return;
      }

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          wantsCamera
            ? { audio: AUDIO_WANTED, video: VIDEO_WANTED }
            : { audio: AUDIO_WANTED },
        );
      } catch (first) {
        if (!wantsCamera) {
          if (!cancelled) {
            setMicFault(mediaFault(first));
            setMicOn(false);
            setAsked(true);
          }
          return;
        }
        // A machine with no camera fails the whole request, microphone and
        // all. Falling back to audio keeps the meeting usable for someone on a
        // desktop with no webcam, which is a great many church offices.
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_WANTED });
          if (!cancelled) {
            setCameraOn(false);
            setCamFault(mediaFault(first));
          }
        } catch (second) {
          if (!cancelled) {
            setMicFault(mediaFault(second));
            setCamFault(mediaFault(first));
            setMicOn(false);
            setCameraOn(false);
            setAsked(true);
          }
          return;
        }
      }

      if (cancelled) {
        stream?.getTracks().forEach((track) => track.stop());
        return;
      }

      // Split what was granted in two, so the camera can be released on its
      // own later without taking the microphone with it.
      const audio = stream?.getAudioTracks() ?? [];
      const video = stream?.getVideoTracks() ?? [];
      micRef.current = audio.length > 0 ? new MediaStream(audio) : null;
      keepCamera(video.length > 0 ? new MediaStream(video) : null);
      if (audio.length > 0) setMicFault(null);
      if (video.length > 0) {
        setCamFault(null);
      } else if (wantsCamera) {
        // Asked for, granted, and nothing came back: there is no camera here.
        // `?? ` so the fallback path's real reason is not overwritten by this
        // guess at one.
        setCameraOn(false);
        setCamFault((existing) => existing ?? "missing");
      }
      setAsked(true);
    })();

    return () => {
      cancelled = true;
      micRef.current?.getTracks().forEach((track) => track.stop());
      micRef.current = null;
      camRef.current?.getTracks().forEach((track) => track.stop());
      camRef.current = null;
    };
  }, [lowDataDefault]);

  /**
   * Open the camera, now, because somebody has just asked for it.
   *
   * The only path to a second permission dialog on this screen, and it is one
   * the person reached by tapping a camera button — so it arrives as an answer
   * to something they did rather than out of nowhere.
   */
  const requestCamera = useCallback(async (): Promise<boolean> => {
    if (camRef.current) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamFault("unsupported");
      return false;
    }
    setAskingCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_WANTED });
      keepCamera(stream);
      setCamFault(null);
      return true;
    } catch (first) {
      const failure = (first as { name?: string })?.name ?? "";
      // Only a constraint problem earns a second attempt. A refusal is a
      // refusal, and asking again just produces the same dialog.
      if (failure === "OverconstrainedError" || failure === "TypeError") {
        try {
          const plain = await navigator.mediaDevices.getUserMedia({ video: true });
          keepCamera(plain);
          setCamFault(null);
          return true;
        } catch (second) {
          setCamFault(mediaFault(second));
          return false;
        }
      }
      setCamFault(mediaFault(first));
      return false;
    } finally {
      setAskingCamera(false);
    }
  }, []);

  /** The camera button. Off releases the device; on takes it, asking if need be. */
  const toggleCamera = useCallback(async () => {
    if (lowData) return;
    if (cameraOn) {
      setCameraOn(false);
      releaseCamera();
      return;
    }
    if (await requestCamera()) setCameraOn(true);
  }, [cameraOn, lowData, releaseCamera, requestCamera]);

  /*
   * Show the preview only while the camera is actually wanted.
   *
   * There is nothing to disable any more — when the camera is off there is no
   * track at all, because it was stopped. This only decides what the `<video>`
   * element is pointed at.
   */
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (cam && cameraOn && !lowData) {
      el.srcObject = cam;
      playMedia(el, "join screen self-preview");
    } else {
      el.srcObject = null;
    }
  }, [cam, cameraOn, lowData]);

  /**
   * Try again, for somebody who has just changed something.
   *
   * A camera that failed on its own is asked for again, because a reload would
   * land back in Data Saver mode and never get round to asking — so the button
   * would appear to do nothing. Anything else reloads: a permission changed in
   * the browser's own panel does not reach a page that is already open, and on
   * this screen reloading costs nothing.
   */
  const retry = () => {
    if (micFault === null && camFault !== null) {
      void requestCamera().then((ok) => {
        if (ok) setCameraOn(true);
      });
      return;
    }
    window.location.reload();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Release the devices here. Permission lives on at the origin, so the room
    // re-acquires what it needs without a second dialog.
    micRef.current?.getTracks().forEach((track) => track.stop());
    micRef.current = null;
    releaseCamera();
    onJoin({
      name: name.trim() || "Guest",
      micOn: micOn && micFault === null,
      // Only if a camera was actually opened here. Saying yes to one we never
      // got would have the room ask for it again, in front of everybody, which
      // is the dialog this screen exists to take care of.
      cameraOn: cameraOn && !lowData && cam !== null,
      lowData,
      passcode,
    });
  };

  /*
   * One panel, for whichever device went wrong.
   *
   * The microphone comes first when both failed: a meeting without a camera is
   * a meeting, and a meeting without a microphone is listening to one.
   */
  const shownFault = micFault ?? camFault;
  const faultDeviceKey: TKey =
    micFault !== null && camFault !== null
      ? "meetings.deviceCameraAndMic"
      : micFault !== null
        ? "meetings.deviceMicrophone"
        : "meetings.deviceCamera";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-950 px-4 py-8 text-white">
      <div className="w-full max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          {churchLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={churchLogo}
              alt=""
              className="size-11 rounded-xl object-cover ring-1 ring-white/15"
            />
          ) : (
            <div className="flex size-11 items-center justify-center rounded-xl bg-indigo-500/20 ring-1 ring-white/15">
              <Video className="size-5 text-indigo-300" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-xl font-bold sm:text-2xl">{title}</h1>
              <BetaBadge tone="dark" />
            </div>
            <p className="truncate text-sm text-slate-400">{churchName}</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Preview */}
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/10">
            {cameraOn && !lowData ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="size-full -scale-x-100 object-cover"
              />
            ) : (
              // `pb-20` clears the control row below, which is absolutely
              // positioned over the bottom of this box.
              <div className="flex size-full flex-col items-center justify-center gap-3 px-4 pb-20">
                <div className="flex size-20 items-center justify-center rounded-full bg-slate-700 text-2xl font-bold">
                  {initialsOf(name || "Guest")}
                </div>
                <p className="text-center text-sm text-balance text-slate-400">
                  {!asked
                    ? // While the browser's own dialog is up. Without this the
                      // screen says "your camera is off", which reads as a
                      // setting rather than as a question waiting to be
                      // answered — and people dismiss the dialog to go and
                      // look for the setting. It names only what is actually
                      // being asked for, so somebody in Data Saver is not told
                      // to allow a camera that was never requested.
                      lowDataDefault
                      ? t("meetings.allowMicToContinue")
                      : t("meetings.allowToContinue")
                    : askingCamera
                      ? t("meetings.allowCameraToContinue")
                      : lowData
                        ? t("meetings.audioOnlyCameraStays")
                        : t("meetings.cameraOff")}
                </p>
              </div>
            )}

            <div className="absolute inset-x-0 bottom-0 flex justify-center gap-3 p-4">
              <RoundToggle
                on={micOn}
                onClick={() => setMicOn((v) => !v)}
                onIcon={<Mic className="size-5" />}
                offIcon={<MicOff className="size-5" />}
                label={micOn ? t("meetings.mute") : t("meetings.unmute")}
              />
              <RoundToggle
                on={cameraOn && !lowData}
                disabled={lowData || askingCamera}
                onClick={() => void toggleCamera()}
                onIcon={<Camera className="size-5" />}
                offIcon={<CameraOff className="size-5" />}
                label={
                  cameraOn ? t("meetings.cameraOff2") : t("meetings.cameraOn2")
                }
              />
            </div>
          </div>

          {/* Form */}
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="join-name" className="mb-1.5 block text-slate-300">
                {t("meetings.yourName")}
              </Label>
              <Input
                id="join-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Grace Okoro"
                maxLength={60}
                autoComplete="name"
                required
                className="border-white/15 bg-white/5 text-white placeholder:text-slate-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                {t("meetings.yourNameHint")}
              </p>
            </div>

            {needsPasscode && (
              <div>
                <Label htmlFor="join-passcode" className="mb-1.5 block text-slate-300">
                  {t("meetings.meetingPasscode")}
                </Label>
                <Input
                  id="join-passcode"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={12}
                  placeholder="6 digits"
                  className="border-white/15 bg-white/5 text-white placeholder:text-slate-500"
                />
              </div>
            )}

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <Switch
                checked={lowData}
                onCheckedChange={(v) => {
                  setLowData(v);
                  // Not just "off" — released. Data Saver turned on with the
                  // camera merely disabled left the light burning for a picture
                  // that was never going to be sent.
                  if (v) {
                    setCameraOn(false);
                    releaseCamera();
                  }
                }}
                aria-label={t("meetings.lowDataMode")}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <Signal className="size-4 text-emerald-400" />
                  {t("meetings.lowDataMode")}
                </span>
                <span className="mt-0.5 block text-xs text-slate-400">
                  {t("meetings.lowDataModeHint")}
                </span>
              </span>
            </label>

            {shownFault && (
              /*
                A panel, not a line of small print. Everything here needs the
                person to go and change something, and Try again is the point:
                a permission changed in the browser's own panel does not reach
                a page that is already open, and on this screen reloading costs
                nothing.

                It names the device that actually failed. A refused camera in
                Data Saver mode is not a reason to tell somebody their
                microphone is broken, and the remedy is in a different place for
                each.
              */
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-xs leading-relaxed text-amber-200">
                  {t(mediaFaultKey(shownFault), { device: t(faultDeviceKey) })}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={askingCamera}
                    onClick={retry}
                  >
                    <RotateCcw className="size-4" /> {t("common.tryAgain")}
                  </Button>
                </div>
                {micFault !== null && (
                  // Only when it is the microphone that failed. With a working
                  // microphone and no camera you are not "joining anyway" —
                  // you are joining, and there is nothing to reassure.
                  <p className="mt-2 text-[11px] text-amber-200/70">
                    {t("meetings.joinAnywayHint")}
                  </p>
                )}
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {error}
              </p>
            )}

            {needsSignIn ? (
              <Button asChild size="lg" className="w-full">
                <a href={signInHref}>{t("meetings.signInToJoin")}</a>
              </Button>
            ) : (
              <Button type="submit" size="lg" disabled={joining} className="w-full">
                {joining ? (
                  <>
                    <Loader2 className="animate-spin" /> {t("meetings.joining")}
                  </>
                ) : (
                  t("meetings.joinMeeting")
                )}
              </Button>
            )}

            <p className="text-center text-[11px] leading-relaxed text-slate-500">
              {t("meetings.privacyNote")}
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

function RoundToggle({
  on,
  onClick,
  onIcon,
  offIcon,
  label,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  onIcon: React.ReactNode;
  offIcon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      className={cn(
        "flex size-12 items-center justify-center rounded-full transition disabled:opacity-40",
        on ? "bg-white/15 text-white hover:bg-white/25" : "bg-rose-500 text-white hover:bg-rose-600",
      )}
    >
      {on ? onIcon : offIcon}
    </button>
  );
}
